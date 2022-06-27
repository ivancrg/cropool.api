const express = require("express");
const app = express();
const bodyParser = require("body-parser");
const cors = require("cors");
const mysql = require("mysql");
require("dotenv").config();
const bcrypt = require("bcrypt");
const routeMgmt = require("./route_management");
const tokenMgmt = require("./token_management");
const { getDatabase } = require("firebase-admin/database");

var admin = require("firebase-admin");

var serviceAccount = require(process.env.FIREBASE_JSON_KEY_LOCATION);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FB_RTDB_URL,
});

const dbFB = getDatabase();

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
  const registration_id = req.body.registration_id;

  const sqlSelect = "SELECT * FROM user WHERE e_mail = ?";

  db.query(sqlSelect, [e_mail], (err, result) => {
    if (err) {
      // Database error, response: feedback + HTTP500

      res.status(500).send({
        feedback: process.env.FEEDBACK_DATABASE_ERROR,
      });

      console.log(err);

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
        "INSERT INTO user (first_name, last_name, e_mail, password, created_at, last_logout, registration_id) VALUES (?, ?, ?, ?, ?, ?, ?)";
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
          registration_id,
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
            // User created, response: access_token, refresh_token, firebase_token, feedback + HTTP201

            tokenMgmt.registerUserGenerateFirebaseJWT(
              result.insertId,
              e_mail,
              first_name + " " + last_name,
              (firebaseToken) => {
                res
                  .setHeader(
                    "access_token",
                    tokenMgmt.generateAccessJWT(result.insertId, e_mail)
                  )
                  .setHeader(
                    "refresh_token",
                    tokenMgmt.generateRefreshJWT(result.insertId, e_mail)
                  )
                  .setHeader("firebase_token", firebaseToken)
                  .status(201)
                  .send({
                    feedback: process.env.FEEDBACK_USER_REGISTERED,
                  });
              }
            );

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

  db.query(sqlSelect, [e_mail], (err, resultSelect) => {
    if (err) {
      // Database error, response: feedback + HTTP500

      res.status(500).send({
        feedback: process.env.FEEDBACK_DATABASE_ERROR,
      });

      return;
    } else {
      if (resultSelect[0]) {
        // User with provided e-mail found

        bcrypt.compare(
          password,
          resultSelect[0].password,
          function (err, result) {
            if (err) {
              console.log(err);
              res.status(500).send({
                feedback: process.env.FEEDBACK_DATABASE_ERROR,
              });
            } else if (result == true) {
              // Passwords match, user found, response: access_token, refresh_token, firebase_token, feedback + HTTP201

              tokenMgmt.generateFirebaseJWT(
                resultSelect[0].iduser,
                (firebaseToken) => {
                  res
                    .setHeader(
                      "access_token",
                      tokenMgmt.generateAccessJWT(
                        resultSelect[0].iduser,
                        e_mail
                      )
                    )
                    .setHeader(
                      "refresh_token",
                      tokenMgmt.generateRefreshJWT(
                        resultSelect[0].iduser,
                        e_mail
                      )
                    )
                    .setHeader("firebase_token", firebaseToken)
                    .status(201)
                    .send({
                      feedback: process.env.FEEDBACK_USER_FOUND,
                    });
                }
              );
            } else {
              // Passwords do not match, user found, response: feedback + HTTP403

              res
                .status(403)
                .send({ feedback: process.env.FEEDBACK_CREDS_INVALID });
            }
          }
        );

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

app.patch("/changePassword", tokenMgmt.authenticateAccessToken, (req, res) => {
  const currentPassword = req.body.current_password;
  const newPassword = req.body.new_password;
  const logoutRequired = req.body.logout_required;

  const sqlSelect = "SELECT password FROM user WHERE e_mail = ?";

  db.query(sqlSelect, [req.user.e_mail], (err, resultSelect) => {
    if (err) {
      // Database error, response: feedback + HTTP500

      res.status(500).send({
        feedback: process.env.FEEDBACK_DATABASE_ERROR,
      });

      return;
    } else {
      if (resultSelect[0]) {
        // User with provided e-mail found

        bcrypt.compare(
          currentPassword,
          resultSelect[0].password,
          function (err, result) {
            if (err) {
              console.log(err);
              res.status(500).send({
                feedback: process.env.FEEDBACK_DATABASE_ERROR,
              });
            } else if (result == true) {
              // Passwords match, user found, can try to change password

              // Update request depends on logout option
              var sqlUpdatePassword, sqlUpdateArray;

              if (
                logoutRequired != null &&
                (logoutRequired == true || logoutRequired.toString() == "true")
              ) {
                // Logout is required
                sqlUpdatePassword =
                  "UPDATE user SET password = ?, last_logout = ? WHERE e_mail = ?";
                sqlUpdateArray = [
                  newPassword,
                  Date.now() / 1000,
                  req.user.e_mail,
                ];
              } else {
                // Logout isn't required
                sqlUpdatePassword =
                  "UPDATE user SET password = ? WHERE e_mail = ?";
                sqlUpdateArray = [newPassword, req.user.e_mail];
              }

              db.query(
                sqlUpdatePassword,
                sqlUpdateArray,
                (errorUpdate, resultUpdate) => {
                  if (errorUpdate) {
                    // Error while updating password

                    console.log(err);
                    res.status(500).send({
                      feedback: process.env.FEEDBACK_DATABASE_ERROR,
                    });

                    return;
                  } else {
                    // Password changed, logged out if required
                    res.status(201).send({
                      feedback: process.env.FEEDBACK_USER_INFO_UPDATED,
                    });

                    return;
                  }
                }
              );
            } else {
              // Passwords do not match, user found, response: feedback + HTTP403

              res
                .status(403)
                .send({ feedback: process.env.FEEDBACK_CREDS_INVALID });

              return;
            }
          }
        );

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

app.patch("/logout", tokenMgmt.authenticateAccessToken, (req, res) => {
  const e_mail = req.user.e_mail;

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

app.get("/tokens", tokenMgmt.authenticateRefreshToken, (req, res) => {
  const sqlSelect = "SELECT * FROM user WHERE e_mail = ?";

  db.query(sqlSelect, [req.user.e_mail], (err, result) => {
    if (err) {
      // Database error, response: feedback + HTTP500

      res.status(500).send({
        feedback: process.env.FEEDBACK_DATABASE_ERROR,
      });

      console.log(err);

      return;
    } else if (result[0]) {
      // User found
      tokenMgmt.generateFirebaseJWT(result[0].iduser, (firebaseToken) => {
        res
          .setHeader(
            "access_token",
            tokenMgmt.generateAccessJWT(result[0].iduser, req.user.e_mail)
          )
          .setHeader("firebase_token", firebaseToken)
          .status(201)
          .send({
            feedback: process.env.TOKEN_GENERATED,
          });
      });
    } else {
      // User not found

      res.status(404).send({
        feedback: process.env.FEEDBACK_USER_NOT_FOUND,
      });

      return;
    }
  });
});

app.get(
  "/accountInfo",
  tokenMgmt.authenticateAccessToken,
  tokenMgmt.authenticateFirebaseToken,
  (req, res) => {
    sqlSelectAccountInfo =
      "SELECT first_name, last_name, user.created_at, profile_picture, COUNT(*) AS number_of_routes FROM user LEFT JOIN route ON route.idowner = user.iduser WHERE iduser = ? AND e_mail = ?";

    db.query(
      sqlSelectAccountInfo,
      [req.user.uid, req.user.e_mail],
      (error, result) => {
        if (error) {
          // Database error, return database error feedback
          console.log(error);
          return res.status(500).send({
            feedback: process.env.FEEDBACK_DATABASE_ERROR,
          });
        } else if (result[0]) {
          // User found, respond with his info

          res.status(200).send({
            first_name: result[0].first_name,
            last_name: result[0].last_name,
            created_at: result[0].created_at,
            profile_picture: result[0].profile_picture,
            number_of_routes: result[0].number_of_routes,
          });
        }
      }
    );
  }
);

app.patch(
  "/updateInfo",
  tokenMgmt.authenticateAccessToken,
  tokenMgmt.authenticateFirebaseToken,
  (req, res) => {
    const first_name = req.body.first_name;
    const last_name = req.body.last_name;
    const profile_picture = req.body.profile_picture;

    var sqlUpdate = "";
    const updateArray = [];

    if (first_name != null && last_name != null && profile_picture != null) {
      sqlUpdate =
        "UPDATE user SET first_name = ?, last_name = ?, profile_picture = ? WHERE e_mail = ?";
      updateArray.push(first_name);
      updateArray.push(last_name);
      updateArray.push(profile_picture);
    } else if (
      first_name == null ||
      (last_name == null && profile_picture != null)
    ) {
      sqlUpdate = "UPDATE user SET profile_picture = ? WHERE e_mail = ?";
      updateArray.push(profile_picture);
    } else if (
      first_name != null &&
      last_name != null &&
      profile_picture == null
    ) {
      sqlUpdate =
        "UPDATE user SET first_name = ?, last_name = ? WHERE e_mail = ?";
      updateArray.push(first_name);
      updateArray.push(last_name);
    } else {
      // All values are null
      return res.statusCode(400);
    }

    updateArray.push(req.user.e_mail);

    db.query(sqlUpdate, updateArray, (err, result) => {
      if (err) {
        // Database error, response: feedback + HTTP500

        res.status(500).send({
          feedback: process.env.FEEDBACK_DATABASE_ERROR,
        });

        return;
      } else {
        // User's name updated, response: feedback + HTTP201

        // Updating user's name in user table record in FB RTDB
        if (first_name != null && last_name != null) {
          dbFB
            .ref(process.env.FB_RTDB_USER_TABLE_NAME)
            .child(req.user.uid)
            .update({
              name: req.body.first_name + " " + req.body.last_name,
            });
        }

        // Updating user's profile picture in user table record in FB RTDB
        if (profile_picture != null) {
          dbFB
            .ref(process.env.FB_RTDB_USER_TABLE_NAME)
            .child(req.user.uid)
            .update({
              profile_picture: req.body.profile_picture,
            });
        }

        // Updating user's authentication FB DB record
        if (first_name != null && last_name != null) {
          admin
            .auth()
            .updateUser(req.user.uid, {
              displayName: first_name + " " + last_name,
            })
            .then((userRecord) => {
              // User successfully updated
            })
            .catch((error) => {
              // Error while updating the user
              console.log(error);
            });
        }

        res.status(201).send({
          feedback: process.env.FEEDBACK_USER_INFO_UPDATED,
        });
      }
    });
  }
);

app.patch(
  "/updateRegistrationToken", 
  tokenMgmt.authenticateAccessToken,
  tokenMgmt.authenticateFirebaseToken,
  (req, res) => {tokenMgmt.updateRegToken(req, res, dbFB);}
);

app.post("/addRoute", tokenMgmt.authenticateAccessToken, (req, res) => {
  routeMgmt.addRoute(req, res);
});

app.post("/findRoute", tokenMgmt.authenticateAccessToken, (req, res) => {
  routeMgmt.findRoute(req, res);
});

app.post("/requestCheckpoint", tokenMgmt.authenticateAccessToken, (req, res) => {
  routeMgmt.createCheckpointRequest(req, res);
});

app.patch("/acceptCheckpoint", tokenMgmt.authenticateAccessToken, (req, res) => {
  routeMgmt.acceptCheckpointRequest(req, res);
});

app.patch("/removeCheckpoint", tokenMgmt.authenticateAccessToken, (req, res) => {
  routeMgmt.removeCheckpoint(req, res);
});

app.patch("/unsubscribeCheckpoint", tokenMgmt.authenticateAccessToken, (req, res) => {
  routeMgmt.unsubscribeCheckpoint(req, res);
});

app.get("/subscribedToRoutes", tokenMgmt.authenticateAccessToken, (req, res) => {
  routeMgmt.getSubscribedToRoutes(req, res);
});

app.get("/myRoutes", tokenMgmt.authenticateAccessToken, (req, res) => {
  routeMgmt.getMyRoutes(req, res);
});

app.post("/requestedCheckpoints", tokenMgmt.authenticateAccessToken, (req, res) => {
  routeMgmt.getRequestedCheckpoints(req, res);
});

app.listen(process.env.PORT || PORT, () => {
  console.log(`Running on port ${PORT}`);
});
