const express = require("express");
const app = express();
const bodyParser = require("body-parser");
const cors = require("cors");
const mysql = require("mysql");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  multipleStatements: true,
});

const PORT = 3001;

app.set("port", process.env.PORT || 3000);

app.use(cors());

app.use(express.json()); //grabbing info from frontend as json
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.post("/register", (req, res) => {
  const first_name = req.body.first_name;
  const last_name = req.body.last_name;
  const e_mail = req.body.e_mail;
  const password_hash = req.body.password;

  const sqlSelect = "SELECT * FROM users WHERE e_mail = ?";

  db.query(sqlSelect, [e_mail], (err, result) => {
    if (err) {
      // Database error, response: feedback + HTTP500

      res.status(500).send({
        feedback: process.env.FEEDBACK_DATABASE_ERROR,
      });

      return;
    } else if (result[0]) {
      // User found, e_mail unavailable, response: feedback + HTTP409

      res
        .status(409)
        .send({ feedback: process.env.FEEDBACK_EMAIL_UNAVAILABLE });

      return;
    } else {
      // User not found, no error in sqlSelect query

      const sqlInsert =
        "INSERT INTO users (first_name, last_name, e_mail, password) VALUES (?, ?, ?, ?)";

      db.query(
        sqlInsert,
        [first_name, last_name, e_mail, password_hash],
        (err, result) => {
          if (err) {
            // Database error, response: feedback + HTTP500

            res.status(500).send({
              feedback: process.env.FEEDBACK_DATABASE_ERROR,
            });

            return;
          } else {
            // User created, response: access_token, refresh_token, feedback + HTTP201

            res
              .setHeader("access_token", generateAccessJWT(e_mail))
              .setHeader("refresh_token", generateRefreshJWT(e_mail))
              .status(201)
              .send({
                feedback: process.env.FEEDBACK_USER_REGISTERED,
              });

            return;
          }
        }
      );
    }
  });
});

app.post("/login", (req, res) => {
  const e_mail = req.body.e_mail;
  const password = req.body.password;

  const sqlSelect = "SELECT * FROM users WHERE e_mail = ?";

  db.query(sqlSelect, [e_mail], (err, result) => {
    if (err) {
      // Database error, response: feedback + HTTP500

      res.status(500).send({
        feedback: process.env.FEEDBACK_DATABASE_ERROR,
      });

      return;
    } else {
      if (result[0]) {
        // User with provided e-mail found

        bcrypt.compare(password, result[0].password, function (err, result) {
          if (err) {
            res.status(500).send({
              feedback: process.env.FEEDBACK_DATABASE_ERROR,
            });
          } else if (result == true) {
            // Passwords match, user found, response: access_token, refresh_token, feedback + HTTP201

            res
              .setHeader("access_token", generateAccessJWT(e_mail))
              .setHeader("refresh_token", generateRefreshJWT(e_mail))
              .status(201)
              .send({
                feedback: process.env.FEEDBACK_USER_FOUND,
              });
          } else {
            // Passwords do not match, user found, response: feedback + HTTP403

            res
              .status(403)
              .send({ feedback: process.env.FEEDBACK_CREDS_INVALID });
          }
        });

        return;
      } else {
        // User not found, response: feedback + HTTP404

        res.status(404).send({
          feedback: process.env.FEEDBACK_USER_NOT_FOUND,
        });

        return;
      }
    }
  });
});

function generateAccessJWT(email) {
  return jwt.sign({ user: email }, process.env.ACCESS_TOKEN_SECRET, {
    expiresIn: "30m",
  });
}

function generateRefreshJWT(email) {
  return jwt.sign({ user: email }, process.env.REFRESH_TOKEN_SECRET, {
    expiresIn: "7d",
  });
}

function authenticateAccessToken(req, res, next) {
  // Function that authenticates the token that was provided
  // If the token is invalid, it returns

  const accessHeader = req.headers["access_token"];
  const token = accessHeader && accessHeader.split(" ")[1];
  console.log(accessHeader);
  // No token provided, reponse HTTP401
  if (token == null) return res.sendStatus(401);

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
    // Token invalid (it was modified), response: HTTP403
    if (err) return res.sendStatus(403);

    // Token valid, communication with user 'user', forward 'user' with next()
    req.user = user;
    next();
  });
}

app.get("/checkAccessToken", authenticateAccessToken, (req, res) => {
  res.json(req.user);
});

app.listen(process.env.PORT || PORT, () => {
  console.log(`Running on port ${PORT}`);
});
