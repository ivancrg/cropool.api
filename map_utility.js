require("dotenv").config();
const mysql = require("mysql");
const { Client } = require("@googlemaps/google-maps-services-js");

const google_client = new Client({});

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  multipleStatements: true,
});

// Filter and sort routes from input by added percentage of current route distance
// when the chosen pickup and dropoff points are included
function sortByDev(
  routes,
  checkpointDistance,
  checkpointDuration,
  pickupLatLng,
  dropoffLatLng,
  cutoff,
  callback
) {
  // Array that will store (routeid, deviationPercentage) for each route
  // We'll sort and slice this array and that will be the end result for requested filter
  var devRoutes = [];

  // Initial number of routes (needed for synchronization)
  // When devRoutes size reaches this number, we know we processed all routes
  // We can then sort, slice and return the end result
  var numberOfRoutes = routes.length;

  // Iterate through all routes
  routes.forEach((route) => {
    selectCheckpoints =
      "SELECT idcheckpoint, pickup_latlng, dropoff_latlng FROM checkpoint WHERE idroute = ? AND status = ?";

    db.query(
      selectCheckpoints,
      [route.idroute, "ACCEPTED"],
      (error, result) => {
        if (error) {
          // Database query error, we skip this route
          console.log(error);

          // We expect that there will be 1 result less than the inital expectation
          // (we skipped one route because of query error)
          numberOfRoutes -= 1;

          return;
        } else {
          // Result are the route's current checkpoints

          // Convert to objects
          checkpoints = Object.values(JSON.parse(JSON.stringify(result)));
          var checkpointWaypoints = [];

          checkpoints.forEach((checkpoint) => {
            // Add checkpoint to directionsAPIQuery using checkpoint.dropoff_latlng and checkpoint.pickup_latlng
            checkpointWaypoints.push(checkpoint.pickup_latlng);
            checkpointWaypoints.push(checkpoint.dropoff_latlng);
          });

          getDistanceDurationWP(
            route.start_latlng,
            route.finish_latlng,
            pickupLatLng,
            dropoffLatLng,
            checkpointWaypoints,
            (error, isRouteValid, distance, duration, directions) => {
              // We processed this route
              numberOfRoutes -= 1;

              if (error) {
                console.log("/directionsAPI", error);
              } else {
                // We take into consideration the distance and duration between chekcpoints
                // without carpooling also (we want the distance deviation to be
                // at least CHECKPOINT_SAVE % less than checkpointDistance)
                // Also, we allow upto CHECKPOINT_TOLERATION % increase in duration
                // (durationDeviation can be upto CHECKPOINT_TOLERATION % bigger than checkpointDuration)
                // (if deviation is equal or more than the actual distance/duration between checkpoints,
                // carpooling doesn't make sense)
                const isCarpoolingValid =
                  distance - route.current_distance <
                    checkpointDistance *
                      (1 - parseFloat(process.env.CHECKPOINT_SAVE)) &&
                  duration - route.current_duration <
                    checkpointDuration *
                      (1 + parseFloat(process.env.CHECKPOINT_TOLERATION));

                if (isRouteValid && isCarpoolingValid) {
                  // Current route is configured in the same way as pickup and dropoff locations
                  // On query's callback:
                  //      const deviationPercentage = (query.directiondistanceInMeters - route.current_distance) / route.current_distance * 100
                  //      (deviationPercentage can be negative if the route shortened, it's unlikely though)
                  deviationPercentage =
                    ((distance - route.current_distance) /
                      route.current_distance) *
                    100.0;

                  devRoutes.push({
                    idroute: route.idroute,
                    idowner: route.idowner,
                    owner_first_name: route.first_name,
                    owner_last_name: route.last_name,
                    owner_profile_picture: route.profile_picture,
                    custom_repetition: route.custom_repetition.data == true,
                    repetition_mode: route.repetition_mode,
                    start_day_of_month: route.start_day_of_month,
                    start_hour_of_day: route.start_hour_of_day,
                    start_minute_of_hour: route.start_minute_of_hour,
                    note: route.note,
                    price_per_km: route.price_per_km,
                    created_at: route.created_at,
                    devPercentage: deviationPercentage,
                    directions: directions,
                  });
                } // Else, just make numberOfRoutes smaller
              }

              if (numberOfRoutes <= 0) {
                // We processed all the routes

                // We sort the routes from the smallest deviation percentage upwards
                devRoutes = devRoutes.sort((dr1, dr2) => {
                  dr1.devPercentage - dr2.devPercentage;
                });

                // We slice the routes to set number
                devRoutes = devRoutes.slice(0, cutoff);

                // We return the end result via callback
                callback(devRoutes);
              }
            }
          );
        }
      }
    );
  });
}

// Filter and sort routes from input by air distances (start, pickup) and (finish, dropoff)
// Keep cutoff best routes
function filterByAirDistance(
  routes,
  pickupLatLng,
  dropoffLatLng,
  cutoff,
  threshold,
  callback
) {
  // Iterate through all routes
  routes.forEach((route) => {
    if (route.start_latlng != null || route.finish_latlng != null) {
      const m = Math.min(
        airDistanceMeters(route.start_latlng, pickupLatLng),
        airDistanceMeters(route.finish_latlng, dropoffLatLng)
      );
      route.air_distance = m < threshold ? m : Number.MAX_SAFE_INTEGER;
    }
  });

  // Sorting in order to keep just what the cutoff says
  routes = routes.sort((r1, r2) => r1.air_distance - r2.air_distance);

  // Slicing in order to perform the cutoff
  routes = routes.slice(0, cutoff);

  callback(routes);
}

// Get latitude from lat,lng format
function getLatFromLatLng(latLng) {
  return latLng.split(",")[0];
}

// Get longitude from lat,lng format
function getLonFromLatLng(latLng) {
  return latLng.split(",")[1];
}

// Converting degrees to radians
function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

// Calculating air distance between two geographical points
function airDistanceMeters(latLng1, latLng2) {
  var lat1 = getLatFromLatLng(latLng1);
  var lon1 = getLonFromLatLng(latLng1);
  var lat2 = getLatFromLatLng(latLng2);
  var lon2 = getLonFromLatLng(latLng2);

  var R = 6371000; // Radius of the Earth in meters
  var dLat = deg2rad(lat2 - lat1);
  var dLon = deg2rad(lon2 - lon1);

  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  // Distance in meters
  var d = R * c;

  return d;
}

// Retreiving info about fastest route using set checkpoints
// Returns (error, isRouteValid, routeDistance, routeDuration)
function getDistanceDurationWP(
  originLatlng,
  destinationLatLng,
  pickupLatLng,
  dropoffLatLng,
  waypoints,
  callback
) {
  const filterWaypoints = [pickupLatLng, dropoffLatLng];
  const extendedWaypoints = filterWaypoints.concat(waypoints);

  //   console.log(extendedWaypoints);

  google_client
    .directions({
      params: {
        key: process.env.DIRECTIONS_API_KEY,
        origin: originLatlng,
        destination: destinationLatLng,
        optimize: true,
        waypoints: extendedWaypoints,
      },
    })
    .then((res) => {
      var routeDistance = 0;
      var routeDuration = 0;

      const directions = res.data.routes[0].overview_polyline.points;

      // console.log(originLatlng, destinationLatLng, waypoints);
      // console.log(res.data);

      // Convert to objects
      legs = Object.values(JSON.parse(JSON.stringify(res.data.routes[0].legs)));

      for (var i = 0; i < legs.length; ++i) {
        leg = legs[i];
        routeDistance += leg.distance.value;
        routeDuration += leg.duration.value;
      }

      // pickupLatLng should always be the 0th waypoint
      // dropoffLatLng should always be the 1st waypoint
      // isRouteValid is false if the given pickup and dropoff points are in reverse
      // order in response's waypoint_order => if they're in a reverse order, that
      // means that the route would have to include going to pickup point, returning
      // to dropoff point and then returning in the original way again to get to finishLatLng
      // Therefore, if the order of pickup and dropoff points is reversed, we invalidate the route
      var isRouteValid;

      waypointOrder = res.data.routes[0].waypoint_order;

      //   console.log(waypointOrder);

      for (var i = 0; i < waypointOrder.length; ++i) {
        if (waypointOrder[i] == 1) {
          // We encountered 1st waypoint (dropoffLatLng) before the 0th waypoint (pickupLatLng),
          // so the order IS reversed and we INVALIDATE this route

          isRouteValid = false;
          break;
        } else if (waypointOrder[i] == 0) {
          // We encountered 0th waypoint (pickupLatLng) before the 1st waypoint (dropoffLatLng),
          // so the order IS NOT reversed and we CONFIRM this route

          isRouteValid = true;
          break;
        }
      }

      callback(null, isRouteValid, routeDistance, routeDuration, directions);
    })
    .catch((exc) => {
      callback(exc, null, null, null, null);
    });
}

// Retreiving info about route from origin to destination
// Returns (error, routeDistance, routeDuration)
function getDistanceDuration(originLatlng, destinationLatLng, callback) {
  google_client
    .directions({
      params: {
        key: process.env.DIRECTIONS_API_KEY,
        origin: originLatlng,
        destination: destinationLatLng,
      },
    })
    .then((res) => {
      var routeDistance = 0;
      var routeDuration = 0;

      // Convert to objects
      legs = Object.values(JSON.parse(JSON.stringify(res.data.routes[0].legs)));

      for (var i = 0; i < legs.length; ++i) {
        leg = legs[i];
        routeDistance += leg.distance.value;
        routeDuration += leg.duration.value;
      }

      callback(null, routeDistance, routeDuration);
    })
    .catch((exc) => {
      callback(exc, null, null);
    });
}

// Retreiving info about fastest route using set checkpoints
// Returns (error, directions)
function getDirections(originLatlng, destinationLatLng, waypoints, callback) {
  var customParams;
  if (waypoints.length <= 0) {
    customParams = {
      key: process.env.DIRECTIONS_API_KEY,
      origin: originLatlng,
      destination: destinationLatLng,
    };
  } else {
    customParams = {
      key: process.env.DIRECTIONS_API_KEY,
      origin: originLatlng,
      destination: destinationLatLng,
      optimize: true,
      waypoints: waypoints,
    };
  }

  google_client
    .directions({
      params: customParams,
    })
    .then((directions) => {
      if (
        directions == null ||
        directions.data == null ||
        directions.data.routes[0] == null ||
        directions.data.routes[0].overview_polyline == null ||
        directions.data.routes[0].overview_polyline.points == null
      ) {
        // No point in forwarding the directions if they're not there
        callback(true, null);
        return;
      }

      callback(null, directions.data.routes[0].overview_polyline.points);
    })
    .catch((exc) => {
      callback(exc, null);
    });
}

module.exports = {
  airDistanceMeters,
  filterByAirDistance,
  sortByDev,
  getDistanceDuration,
  getDirections,
};
