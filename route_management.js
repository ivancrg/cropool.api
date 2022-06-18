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
  const startTS = req.body.start_timestamp;
  const repetitionMode = req.body.repetition_mode;
  const pricePerKm = req.body.price_per_km;

  if (
    idowner == null ||
    startLatLng == null ||
    finishLatLng == null ||
    startTS == null ||
    repetitionMode == null ||
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

      // Query for inserting route record in route table
      const insertRouteQuery =
        "INSERT INTO route (idowner, start_latlng, finish_latlng, start_timestamp, repetition_mode, price_per_km, current_distance, current_duration, created_at, next_start_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

      db.query(
        insertRouteQuery,
        [
          idowner,
          startLatLng,
          finishLatLng,
          startTS,
          repetitionMode,
          pricePerKm,
          distance,
          duration,
          Date.now(),
          startTS,
        ],
        (err, result) => {
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
        }
      );
    }
  );
}

function findRoute(req, res) {
  const passengerID = req.body.passenger_id;

  if (passengerID == null) {
    // Passenger ID has to be specified
    // (owner can't be his own passenger)

    res.status(400).send({
      feedback: process.env.FEEDBACK_INVALID_REQUEST,
    });

    return;
  }

  const pickupLatLng = req.body.pickup_latlng;
  const dropoffLatLng = req.body.dropoff_latlng;
  const pickupTimestamp = req.body.pickup_timestamp;
  const repetitionMode = req.body.repetition_mode;
  const maxPricePerKm = req.body.max_price_per_km;
  const pickupTimestampTolerance =
    req.body.pickup_timestamp_tolerance != null
      ? req.body.pickup_timestamp_tolerance
      : 0;

  // 1. Filter by repetitionMode (if null, skip) --> selectModePriceTS
  // 2. Filter by maxPriceByKm (if null, skip) --> selectModePriceTS
  // 3. Filter by pickupTimestamp with pickupTimestampTolerance (if null, skip) --> selectModePriceTS
  // 4. Sort and select best 50 routes by lowest value of fitness function
  //    min(airDistance(start_latlng, pickup_latlng), shortestPath(finish_latlng, dropoff_latlng)) relative to current_distance
  //    (we want routes where fitness function has the lowest percentage of current_distance (smallest movement from the start/finish))
  //    (this is just used to eliminate very unsuitable routes - e.g. from another country, continent etc.)
  // 5. Sort and select 25 routes from input s using the deviation from current_distance when adding the wanted checkpoint (pickup + dropoff)

  // Creating such query so that all values from filters 1, 2 and 3 can be null
  selectModePriceTS =
    "SELECT idroute, start_latlng, finish_latlng, current_distance, current_duration FROM route WHERE idowner <> ?" +
    (repetitionMode != null ? " AND repetition_mode = ?" : "") +
    (maxPricePerKm != null ? " AND price_per_km <= ?" : "") +
    (pickupTimestamp != null ? " AND ABS(start_timestamp - ?) <= ?" : "");

  var selectModePriceTSArray = [passengerID];

  // DO NOT CHANGE ORDER (DEPENDING ON CREATION OF selectModePriceTS)
  if (repetitionMode != null) selectModePriceTSArray.push(repetitionMode);
  if (maxPricePerKm != null) selectModePriceTSArray.push(maxPricePerKm);
  if (pickupTimestamp != null) {
    selectModePriceTSArray.push(pickupTimestamp);
    selectModePriceTSArray.push(pickupTimestampTolerance);
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

module.exports = { addRoute, findRoute };
