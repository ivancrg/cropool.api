const mysql = require("mysql");
require("dotenv").config();

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

  // TODO: currentDistance = shortestPath(startLatLng, finishLatLng);
  const currentDistance = 0;

  // Query for inserting route record in route table
  const insertRouteQuery =
    "INSERT INTO route (idowner, start_latlng, finish_latlng, start_timestamp, repetition_mode, price_per_km, current_distance, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";

  db.query(
    insertRouteQuery,
    [
      idowner,
      startLatLng,
      finishLatLng,
      startTS,
      repetitionMode,
      pricePerKm,
      currentDistance,
      Date.now(),
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

module.exports = { addRoute };
