const express = require("express");
const app = express();
const bodyParser = require("body-parser");
const cors = require("cors");
const mysql = require("mysql");
require("dotenv").config();
const bcrypt = require("bcrypt");
const tokenMgmt = require("./token_management");

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

app.use(express.json()); // Grabbing info from frontend as JSON
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.post("/register", (req, res) => {
  const first_name = req.body.first_name;
  const last_name = req.body.last_name;
  const e_mail = req.body.e_mail;
  const password_hash = req.body.password;

  const sqlSelect = "SELECT * FROM user WHERE e_mail = ?";

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
        "INSERT INTO user (first_name, last_name, e_mail, password, created_on, last_logout) VALUES (?, ?, ?, ?, ?, ?)";
      currentTimeSeconds = Math.round(Date.now() / 1000);

      db.query(
        sqlInsert,
        [
          first_name,
          last_name,
          e_mail,
          password_hash,
          currentTimeSeconds,
          currentTimeSeconds,
        ],
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
              .setHeader("access_token", tokenMgmt.generateAccessJWT(e_mail))
              .setHeader("refresh_token", tokenMgmt.generateRefreshJWT(e_mail))
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

  const sqlSelect = "SELECT * FROM user WHERE e_mail = ?";

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
              .setHeader("access_token", tokenMgmt.generateAccessJWT(e_mail))
              .setHeader("refresh_token", tokenMgmt.generateRefreshJWT(e_mail))
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

app.patch("/logout", (req, res) => {
  const e_mail = req.body.e_mail;

  const sqlUpdate = "UPDATE user SET last_logout = ? WHERE e_mail = ?";

  db.query(
    sqlUpdate,
    [Math.round(Date.now() / 1000), e_mail],
    (err, result) => {
      if (err) {
        // Database error, response: feedback + HTTP500
        
        res.status(500).send({
          feedback: process.env.FEEDBACK_DATABASE_ERROR,
        });

        return;
      } else {
        // User logged out, user's last logout time updated, response: feedback + HTTP201

        res.status(201).send({
          feedback: process.env.FEEDBACK_USER_LOGGED_OUT,
        });
      }
    }
  );
});

app.get("/accessToken", tokenMgmt.authenticateRefreshToken, (req, res) => {
  res
    .setHeader("access_token", tokenMgmt.generateAccessJWT(req.user.e_mail))
    .status(201)
    .send({
      feedback: process.env.TOKEN_GENERATED,
    });
});

app.listen(process.env.PORT || PORT, () => {
  console.log(`Running on port ${PORT}`);
});
