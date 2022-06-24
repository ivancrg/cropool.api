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
  const name = req.body.name != null ? req.body.name : "My route";
  const maxNumPassengers =
    req.body.max_num_passengers != null ? req.body.max_num_passengers : 3;
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
        "INSERT INTO route (idowner, name, max_num_passengers, start_latlng, finish_latlng, custom_repetition, current_distance, current_duration, price_per_km, repetition_mode, start_month, start_day_of_month, start_day_of_week, start_hour_of_day, start_minute_of_hour, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
      insertRouteQueryArr = [
        idowner,
        name,
        maxNumPassengers,
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

// Creates a request for adding a checkpoint to a route
function createCheckpointRequest(req, res) {
  // We don't check whether an accepted equal checkpoint already exists because checkpoints are requested
  // through frontend only which also relies on findRoute function which doesn't show accepted checkpoints

  const idroute = req.body.id_route;
  const idpassenger = req.body.id_passenger;
  const pickupLatLng = req.body.pickup_latlng;
  const dropoffLatLng = req.body.dropoff_latlng;

  // Get the created checkpoint's creator's iduser for sending a notification
  selectCheckpointRouteUserID =
    "SELECT idowner, name FROM route WHERE idroute = ?";

  db.query(selectCheckpointRouteUserID, [idroute], (err, result) => {
    if (err) {
      // Can't get checkpoint route creator's iduser
      // Notification won't be sent
      console.log(err);
    } else {
      // iduser fetched
      if (result[0].idowner == idpassenger) {
        // Owner of the route can't be his own passenger, don't notify or create request
        res.status(400).send({
          feedback: process.env.FEEDBACK_INVALID_REQUEST,
        });

        return;
      }

      // Passenger isn't the route's owner so we can proceed with adding request/sending notification

      // Status' default value is REQUESTED so we don't need to explicitly add it
      insertCheckpointQuery =
        "INSERT INTO checkpoint (idroute, idpassenger, pickup_latlng, dropoff_latlng) VALUES (?, ?, ?, ?)";

      db.query(
        insertCheckpointQuery,
        [idroute, idpassenger, pickupLatLng, dropoffLatLng],
        (errInsert, resultInsert) => {
          if (errInsert) {
            // Database error, response: feedback + HTTP500

            res.status(500).send({
              feedback: process.env.FEEDBACK_DATABASE_ERROR,
            });

            console.log(errInsert);

            return;
          } else {
            // Checkpoint created created, response: send a notification to checkpoint route's creator, feedback + HTTP201

            // Send the owner a notification
            // Send notification to user result[0].idowner saying that user idpassenger
            // sent a request to connect to his route result[0].name
            console.log(
              "NOTIFICATION TO:",
              result[0].idowner,
              idpassenger,
              "wants to connect to your route",
              result[0].name
            );
            // sendCheckpointRequestNotif(result[0].idowner, idpassenger, result[0].name);

            res.status(201).send({
              feedback: process.env.FEEDBACK_CHECKPOINT_CREATED,
            });

            return;
          }
        }
      );
    }
  });
}

// Accepts a requested checkpoint if max_num_passengers >= accepted_num_passengers
function acceptCheckpointRequest(req, res) {
  const checkpointID = req.body.id_checkpoint;

  // iduser forwarded when validating access token to
  // check whether the user is trying to accept his own checkpoint request
  const userID = req.user.iduser;

  // All values need to be defined
  if (checkpointID == null || userID == null) {
    res.status(400).send({
      feedback: process.env.FEEDBACK_INVALID_REQUEST,
    });

    return;
  }

  // Get checkpoint/respective route info
  const infoSelect =
    "SELECT route.idroute, idowner, name, max_num_passengers FROM checkpoint LEFT JOIN route ON checkpoint.idroute = route.idroute WHERE checkpoint.idroute = (SELECT idroute FROM checkpoint WHERE idcheckpoint = ?)";

  db.query(infoSelect, [checkpointID], (infoError, infoResult) => {
    if (infoError) {
      // Database error, response: feedback + HTTP500

      res.status(500).send({
        feedback: process.env.FEEDBACK_DATABASE_ERROR,
      });

      console.log(infoError);

      return;
    } else {
      if (
        infoResult[0] == null ||
        infoResult[0].idroute == null ||
        infoResult[0].idowner == null ||
        infoResult[0].name == null ||
        infoResult[0].max_num_passengers == null
      ) {
        // Checkpoint ID does not exist

        return res.status(404).send({
          feedback: process.env.FEEDBACK_CHECKPOINT_DOESNT_EXIST,
        });
      }

      if (infoResult[0].idowner != userID) {
        // User is trying to update someone else's checkpoint request
        return res.sendStatus(403);
      }

      // Check already accepted number of passengers vs max number of passengers
      const checkNumberPassengersQry =
        "SELECT COUNT(*) AS accepted_num_passengers FROM checkpoint WHERE idroute = ? AND status = 'ACCEPTED'";
      db.query(
        checkNumberPassengersQry,
        [infoResult[0].idroute],
        (checkNumberError, checkNumberResult) => {
          if (
            checkNumberError ||
            checkNumberResult[0].accepted_num_passengers == null
          ) {
            // Database error, response: feedback + HTTP500

            res.status(500).send({
              feedback: process.env.FEEDBACK_DATABASE_ERROR,
            });

            console.log(infoError);

            return;
          }

          if (
            infoResult[0].max_num_passengers <=
            checkNumberResult[0].accepted_num_passengers
          ) {
            // Route passenger capacity reached (or surpassed), can't accept the request
            res.status(400).send({
              feedback: process.env.FEEDBACK_ROUTE_CAPACITY_REACHED,
            });

            return;
          }

          // User accepting checkpoint request for his own route, passenger capacity is enough
          // Additional passenger still fits, can accept the request
          acceptCheckpointQry =
            "UPDATE checkpoint SET status = 'ACCEPTED' WHERE idcheckpoint = ?";
          db.query(
            acceptCheckpointQry,
            [checkpointID],
            (acceptCheckpointError, acceptCheckpointResult) => {
              if (acceptCheckpointError) {
                // Database error, response: feedback + HTTP500

                res.status(500).send({
                  feedback: process.env.FEEDBACK_DATABASE_ERROR,
                });

                console.log(acceptCheckpointError);

                return;
              } else {
                // Query to find the passenger ID
                const passengerIDQry =
                  "SELECT idpassenger FROM checkpoint WHERE idcheckpoint = ?";
                db.query(
                  passengerIDQry,
                  [checkpointID],
                  (passengerIDError, passengerIDResult) => {
                    if (passengerIDError) {
                      // Notification can't be sent (couldn't query the ID of passenger)
                      console.log(passengerIDError);
                    } else if (passengerIDResult[0].idpassenger != null) {
                      // Send the passenger a notification
                      // Send notification to user idpassenger saying that his request
                      // to connect to route name was accepted
                      console.log(
                        "NOTIFICATION TO:",
                        passengerIDResult[0].idpassenger,
                        "Your checkpoint request to route",
                        infoResult[0].name,
                        "was accepted."
                      );
                      // sendCheckpointAcceptedNotif(checkNumberResult[0].idpassenger, checkNumberResult[0].name);
                    }
                  }
                );

                res.status(201).send({
                  feedback: process.env.FEEDBACK_CHECKPOINT_ACCEPTED,
                });

                return;
              }
            }
          );
        }
      );
    }
  });
}

// Receives a requested checkpoint and moves it to checkpoint_declined, notifies the declined/removed passenger
function removeCheckpoint(req, res) {
  const checkpointID = req.body.id_checkpoint;

  // iduser forwarded when validating access token to
  // check whether the user is trying to delete his own route's checkpoint request/deal
  const userID = req.user.iduser;

  // All values need to be defined
  if (checkpointID == null || userID == null) {
    res.status(400).send({
      feedback: process.env.FEEDBACK_INVALID_REQUEST,
    });

    return;
  }

  // Check info of (checkpoint to be deleted)'s route of accepted checkpoints
  checkInfoQry =
    "SELECT idowner, name, idpassenger FROM checkpoint LEFT JOIN route ON checkpoint.idroute = route.idroute WHERE idcheckpoint = ?";

  db.query(checkInfoQry, [checkpointID], (checkInfoError, checkInfoResult) => {
    if (checkInfoError) {
      // Database error, response: feedback + HTTP500

      res.status(500).send({
        feedback: process.env.FEEDBACK_DATABASE_ERROR,
      });

      console.log(checkInfoError);

      return;
    } else {
      if (
        checkInfoResult[0] == null ||
        checkInfoResult[0].idowner == null ||
        checkInfoResult[0].name == null ||
        checkInfoResult[0].idpassenger == null
      ) {
        // Checkpoint ID does not exist

        return res.status(404).send({
          feedback: process.env.FEEDBACK_CHECKPOINT_DOESNT_EXIST,
        });
      }

      if (checkInfoResult[0].idowner != userID) {
        // User is trying to update someone else's checkpoint request
        return res.sendStatus(403);
      }

      // User deleting checkpoint of his own route
      // Can delete the request and insert it into checkpoint_removed table
      const moveCheckpointQry =
        "INSERT INTO checkpoint_removed SELECT * FROM checkpoint WHERE idcheckpoint = ?; DELETE FROM checkpoint WHERE idcheckpoint = ?;";
      db.query(
        moveCheckpointQry,
        [checkpointID, checkpointID],
        (moveCheckpointError, moveCheckpointResult) => {
          if (moveCheckpointError) {
            // Database error, response: feedback + HTTP500

            res.status(500).send({
              feedback: process.env.FEEDBACK_DATABASE_ERROR,
            });

            console.log(moveCheckpointError);

            return;
          } else {
            // Send the passenger a notification
            // Send notification to user idpassenger saying that his
            // connection/request for a connection to route name was declined
            console.log(
              "NOTIFICATION TO:",
              checkInfoResult[0].idpassenger,
              "Your existing or pending checkpoint in route",
              checkInfoResult[0].name,
              "was removed."
            );
            // sendRemovedCheckpoint(checkInfoResult[0].idpassenger, checkInfoResult[0].name);

            res.status(201).send({
              feedback: process.env.FEEDBACK_CHECKPOINT_REMOVED,
            });

            return;
          }
        }
      );
    }
  });
}

// Receives an accepted checkpoint and deletes it, notifies the owner of route
function unsubscribeCheckpoint(req, res) {
  const checkpointID = req.body.id_checkpoint;

  // iduser forwarded when validating access token to
  // check whether the user is trying to delete the checkpoint
  // he is actually a passenger of
  const userID = req.user.iduser;

  // All values need to be defined
  if (checkpointID == null || userID == null) {
    res.status(400).send({
      feedback: process.env.FEEDBACK_INVALID_REQUEST,
    });

    return;
  }

  // Check info of the checkpoint to be unsubscribed from
  checkInfoQry =
    "SELECT idowner, name, idpassenger FROM checkpoint LEFT JOIN route ON checkpoint.idroute = route.idroute WHERE idcheckpoint = ?";

  db.query(checkInfoQry, [checkpointID], (checkInfoError, checkInfoResult) => {
    if (checkInfoError) {
      // Database error, response: feedback + HTTP500

      res.status(500).send({
        feedback: process.env.FEEDBACK_DATABASE_ERROR,
      });

      console.log(checkInfoError);

      return;
    } else {
      if (
        checkInfoResult[0] == null ||
        checkInfoResult[0].idowner == null ||
        checkInfoResult[0].name == null ||
        checkInfoResult[0].idpassenger == null
      ) {
        // Checkpoint ID does not exist

        return res.status(404).send({
          feedback: process.env.FEEDBACK_CHECKPOINT_DOESNT_EXIST,
        });
      }

      if (checkInfoResult[0].idpassenger != userID) {
        // User is trying to delete someone else's checkpoint
        return res.sendStatus(403);
      }

      // User deleting his own route checkpoint
      // Can delete the request and insert it into checkpoint_removed table
      const moveCheckpointQry =
        "INSERT INTO checkpoint_removed SELECT * FROM checkpoint WHERE idcheckpoint = ?; DELETE FROM checkpoint WHERE idcheckpoint = ?;";
      db.query(
        moveCheckpointQry,
        [checkpointID, checkpointID],
        (moveCheckpointError, moveCheckpointResult) => {
          if (moveCheckpointError) {
            // Database error, response: feedback + HTTP500

            res.status(500).send({
              feedback: process.env.FEEDBACK_DATABASE_ERROR,
            });

            console.log(moveCheckpointError);

            return;
          } else {
            // Send the owner a notification
            // Send notification to user idowner saying that his
            // route name lost a passenger/request
            console.log(
              "NOTIFICATION TO:",
              checkInfoResult[0].idowner,
              "Your existing or pending passenger in route",
              checkInfoResult[0].name,
              "was removed."
            );
            // sendUnsubscribedCheckpoint(checkInfoResult[0].idowner, checkInfoResult[0].name);

            res.status(201).send({
              feedback: process.env.FEEDBACK_CHECKPOINT_UNSUBSCRIBED,
            });

            return;
          }
        }
      );
    }
  });
}

// Retreives list of routes subscribed (accepted/requested checkpoint) to for user req.user.iduser
function getSubscribedToRoutes(req, res){
    // TODO
}

// Retreives list of created routes of user req.user.iduser
function getMyRoutes(req, res){
    // TODO
}

module.exports = {
  addRoute,
  findRoute,
  createCheckpointRequest,
  acceptCheckpointRequest,
  removeCheckpoint,
  unsubscribeCheckpoint,
};
