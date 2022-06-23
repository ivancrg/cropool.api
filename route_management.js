const { query } = require("express");
const mysql = require("mysql");
require("dotenv").config();
const map_util = require("./map_utility");

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  multipleStatements: true,
});

function addRoute(req, res) {
  const idowner = req.body.id_owner;
  const startLatLng = req.body.start_latlng;
  const finishLatLng = req.body.finish_latlng;
  const repetitionMode = req.body.repetition_mode;
  const pricePerKm = req.body.price_per_km;
  const customRepetition =
    req.body.custom_repetition == null
      ? false
      : req.body.custom_repetition === true
      ? true
      : false;
  const startMonth = req.body.start_month;
  const startDayOfMonth = req.body.start_day_of_month;
  const startDayOfWeek = req.body.start_day_of_week;
  const startHourOfDay = req.body.start_hour_of_day;
  const startMinuteOfHour = req.body.start_minute_of_hour;
  const note = req.body.note;

  if (
    idowner == null ||
    startLatLng == null ||
    finishLatLng == null ||
    // If repetition isn't custom, all of these things need to be defined
    // Although we won't need some values for finding a route...
    (customRepetition == false &&
      (repetitionMode == null ||
        startMonth == null ||
        startDayOfMonth == null ||
        startDayOfWeek == null ||
        startHourOfDay == null ||
        startMinuteOfHour == null)) ||
    // If repetition is custom, we need to have a note describing it
    (customRepetition == true && note == null) ||
    // Repetition can't be both custom and predefined
    (customRepetition == true && repetitionMode != null) ||
    pricePerKm == null
  ) {
    res.status(400).send({
      feedback: process.env.FEEDBACK_INVALID_REQUEST,
    });

    return;
  }

  currentDistance = map_util.airDistanceMeters(startLatLng, finishLatLng);

  map_util.getDistanceDuration(
    startLatLng,
    finishLatLng,
    (error, distance, duration) => {
      if (error) {
        distance = map_util.airDistanceMeters(startLatLng, finishLatLng);

        // Very rough approximation, error is unlikely...
        duration = distance / 60.0;
      }

      var insertRouteQuery = "";
      var insertRouteQueryArr = [];

      insertRouteQuery =
        "INSERT INTO route (idowner, start_latlng, finish_latlng, custom_repetition, current_distance, current_duration, price_per_km, repetition_mode, start_month, start_day_of_month, start_day_of_week, start_hour_of_day, start_minute_of_hour, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
      insertRouteQueryArr = [
        idowner,
        startLatLng,
        finishLatLng,
        customRepetition,
        distance,
        duration,
        pricePerKm,
        repetitionMode,
        startMonth,
        startDayOfMonth,
        startDayOfWeek,
        startHourOfDay,
        startMinuteOfHour,
        note,
        Date.now(),
      ];

      db.query(insertRouteQuery, insertRouteQueryArr, (err, result) => {
        if (err) {
          // Database error, response: feedback + HTTP500

          res.status(500).send({
            feedback: process.env.FEEDBACK_DATABASE_ERROR,
          });

          console.log(err);

          return;
        } else {
          // Route created, response: feedback + HTTP201

          res.status(201).send({
            feedback: process.env.FEEDBACK_ROUTE_CREATED,
          });

          return;
        }
      });
    }
  );
}

function findRoute(req, res) {
  const passengerID = req.body.passenger_id;
  const pickupLatLng = req.body.pickup_latlng;
  const dropoffLatLng = req.body.dropoff_latlng;
  const maxPricePerKm = req.body.max_price_per_km;
  const customRepetition = req.body.custom_repetition;
  const repetitionMode = req.body.repetition_mode;
  const startMonth = req.body.start_month;
  const startDayOfMonth = req.body.start_day_of_month;
  const startDayOfWeek = req.body.start_day_of_week;
  const startHourOfDay = req.body.start_hour_of_day;
  const startMinuteOfHour = req.body.start_minute_of_hour;
  const pickupSecondsTolerance =
    req.body.pickup_timestamp_tolerance != null
      ? req.body.pickup_timestamp_tolerance
      : process.env.PICKUP_SECONDS_TOLERANCE;

  if (
    passengerID == null ||
    pickupLatLng == null ||
    dropoffLatLng == null ||
    (customRepetition == null && repetitionMode == null) ||
    (repetitionMode != null &&
      (startDayOfMonth == null ||
        startHourOfDay == null ||
        startMinuteOfHour == null))
  ) {
    // Passenger ID has to be specified
    // (owner can't be his own passenger)

    // If repetition is defined, we need some values at least

    res.status(400).send({
      feedback: process.env.FEEDBACK_INVALID_REQUEST,
    });

    return;
  }

  // 1. Filter by repetitionMode (if null, skip) --> selectModePriceTS
  // 2. Filter by maxPriceByKm (if null, skip) --> selectModePriceTS
  // 3. Filter by pickupTimestamp with pickupTimestampTolerance (if null, skip) --> selectModePriceTS
  // 4. Filter by already accepted/requested checkpoint requests (if there is an accepted or currently being considered checkpoint for the user
  // and for some route, we won't take it into consideration (checkpoint table should ONLY contain accepted requests or not yet denied requests))
  // (denied requests should be moved to checkpoint_denied table)
  // 5. Sort and select best 50 routes by lowest value of fitness function
  //    min(airDistance(start_latlng, pickup_latlng), shortestPath(finish_latlng, dropoff_latlng)) relative to current_distance
  //    (we want routes where fitness function has the lowest percentage of current_distance (smallest movement from the start/finish))
  //    (this is just used to eliminate very unsuitable routes - e.g. from another country, continent etc.)
  // 6. Sort and select 25 routes from input s using the deviation from current_distance when adding the wanted checkpoint (pickup + dropoff)

  // Creating such query so that all values from filters 1, 2 and 3 can be null
  var selectModePriceTS =
    "SELECT route.idroute, idowner, start_latlng, finish_latlng, current_distance, current_duration FROM route LEFT JOIN checkpoint ON checkpoint.idroute = route.idroute WHERE idowner <> ?  AND (checkpoint.idpassenger IS NULL OR checkpoint.idpassenger <> ? OR checkpoint.status <> 'ACCEPTED')" +
    (maxPricePerKm != null ? " AND price_per_km <= ?" : "") +
    (customRepetition === true && repetitionMode == null
      ? " AND custom_repetition = TRUE"
      : repetitionTimeQuery(
          repetitionMode,
          startDayOfMonth,
          startHourOfDay,
          startMinuteOfHour,
          pickupSecondsTolerance
        )[0]) +
    " GROUP BY route.idroute";

  var selectModePriceTSArray = [passengerID, passengerID];

  // DO NOT CHANGE ORDER (DEPENDING ON CREATION OF selectModePriceTS)
  if (maxPricePerKm != null) selectModePriceTSArray.push(maxPricePerKm);
  if (!(customRepetition === true && repetitionMode == null)) {
    selectModePriceTSArray = selectModePriceTSArray.concat(
      repetitionTimeQuery(
        repetitionMode,
        startDayOfMonth,
        startHourOfDay,
        startMinuteOfHour,
        pickupSecondsTolerance
      )[1]
    );
  }

  db.query(
    selectModePriceTS,
    selectModePriceTSArray,
    (selectModePriceTSErr, selectModePriceTSRes) => {
      if (selectModePriceTSErr) {
        // Database error, response: feedback + HTTP500

        res.status(500).send({
          feedback: process.env.FEEDBACK_DATABASE_ERROR,
        });

        console.log(selectModePriceTSErr);

        return;
      } else {
        // Convert to objects
        selectModePriceTSRes = Object.values(
          JSON.parse(JSON.stringify(selectModePriceTSRes))
        );

        map_util.filterByAirDistance(
          selectModePriceTSRes,
          pickupLatLng,
          dropoffLatLng,
          process.env.MAX_ROUTES_AIR_DISTANCE_FILTER,
          process.env.THRESHOLD_AIR_DISTANCE,
          (filteredByAirDistanceRes) => {
            // console.log("FILTEREDAIRDST:", filteredByAirDistanceRes);
            // Caclulating distance and duration between checkpoint locations
            // Routes with distance deviation equal/bigger than distance between checkpoints
            // or duration deviation equal/bigger than duration between checkpoints shouldn't
            // be valid (we won't save considerable amount of distance/time by carpooling)
            map_util.getDistanceDuration(
              pickupLatLng,
              dropoffLatLng,
              (error, checkpointDistance, checkpointDuration) => {
                if (error) {
                  checkpointDistance = checkpointDuration = 0;
                }

                map_util.sortByDev(
                  filteredByAirDistanceRes,
                  checkpointDistance,
                  checkpointDuration,
                  pickupLatLng,
                  dropoffLatLng,
                  process.env.MAX_ROTUES_CHECKPOINTS_FILTER,
                  (sortedByDevRes) => {
                    res.status(200).send({
                      result: sortedByDevRes,
                      feedback: process.env.FEEDBACK_ROUTES_FILTERED,
                    });
                  }
                );
              }
            );
          }
        );

        return;
      }
    }
  );
}

// Creates part of query that filters using repetition and start time parameters
function repetitionTimeQuery(
  repetitionMode,
  startDayOfMonth,
  startHourOfDay,
  startMinuteOfHour,
  pickupSecondsTolerance
) {
  var qry = "";
  var qryArray = [];

  if (repetitionMode == process.env.REPETITION_DAILY) {
    // If repetition is daily, we need startHourOfDay, startMinuteOfHour and pickupSecondsTolerance

    qry =
      "repetition_mode = ? AND ABS((start_hour_of_day * 60 + start_minute_of_hour) - ?) <= ?";
    qryArray = [
      repetitionMode,
      startHourOfDay * 60 + startMinuteOfHour,
      pickupSecondsTolerance,
    ];
  } else if (repetitionMode == process.env.REPETITION_MONTHLY) {
    // If repetition is monthly, we need startDayOfMonth, startHourOfDay, startMinuteOfHour and pickupSecondsTolerance

    // const lastDayOfMonth =
    //   startMonth == 2
    //     ? 28
    //     : startMonth != 2 &&
    //       ((startMonth % 2 == 0 && startMonth <= 6) ||
    //         (startMonth % 2 == 1 && startMonth >= 9))
    //     ? 30
    //     : 31;

    qry =
      "repetition_mode = ? AND start_day_of_month = ? AND ABS((start_hour_of_day * 60 + start_minute_of_hour) - ?) <= ?";
    qryArray = [
      repetitionMode,
      startDayOfMonth,
      startHourOfDay * 60 + startMinuteOfHour,
      pickupSecondsTolerance,
    ];
  } else {
    // Repetition on selected days
    // MON = 1000000
    // TUE = 200000
    // WED = 30000
    // THU = 4000
    // FRI = 500
    // SAT = 60
    // SUN = 7

    qry =
      "repetition_mode = ? AND ABS((start_hour_of_day * 3600 + start_minute_of_hour * 60) - ?) <= ?";
    qryArray = [
      repetitionMode,
      parseFloat(startHourOfDay) * 3600 + parseFloat(startMinuteOfHour) * 60,
      pickupSecondsTolerance,
    ];
  }

  return [" AND " + qry, qryArray];
}

function requestCheckpoint(req, res) {}

module.exports = { addRoute, findRoute };
