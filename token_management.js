const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const saltRounds = 10;
const mysql = require("mysql");
require("dotenv").config();
var admin = require("firebase-admin");

var serviceAccount = require(process.env.FIREBASE_JSON_KEY_LOCATION);

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  multipleStatements: true,
});

function generateAccessJWT(email) {
  return jwt.sign({ e_mail: email }, process.env.ACCESS_TOKEN_SECRET, {
    expiresIn: "5m",
  });
}

function generateRefreshJWT(email) {
  return jwt.sign({ e_mail: email }, process.env.REFRESH_TOKEN_SECRET, {
    expiresIn: "7d",
  });
}

function registerUserGenerateFirebaseJWT(iduser, email, displayName, callback) {
  admin
    .auth()
    .createUser({
      uid: iduser.toString(),
      email: email,
      displayName: displayName,
    })
    .then((userRecord) => {
      admin
        .auth()
        .createCustomToken(iduser.toString())
        .then((customToken) => {
          callback(customToken);
        })
        .catch((err) => {
          console.log("Error creating custom token: ", err);
        });
    })
    .catch((err) => {
      console.log("Error creating a new user: ", err);
    });
}

function generateFirebaseJWT(iduser, callback) {
  admin
    .auth()
    .createCustomToken(iduser.toString())
    .then((customToken) => {
      callback(customToken);
    })
    .catch((err) => {
      console.log("Error creating custom token: ", err);
    });
}

function authenticateToken(tokenName, req, res, next) {
  // Function that authenticates the token that was provided
  // The function also checks whether the token is active (issued after last logout timestamp)
  // (If the user has logged out, all of his refresh tokens were invalidated)

  const tokenHeader = req.headers[tokenName];
  const token = tokenHeader && tokenHeader.split(" ")[1];

  // No token provided, reponse HTTP401
  if (token == null) return res.sendStatus(401);

  jwt.verify(
    token,
    tokenName == "refresh_token"
      ? process.env.REFRESH_TOKEN_SECRET
      : process.env.ACCESS_TOKEN_SECRET,
    (err, user) => {
      // Token invalid (it was modified), response: HTTP403
      if (err) return res.sendStatus(403);

      // Token VALID, it was issued to user 'user.e_mail'

      // Validating token issued-at-wise
      const sqlSelect =
        "SELECT created_at, last_logout FROM user WHERE e_mail = ?";

      db.query(sqlSelect, [user.e_mail], (err, result) => {
        if (err) {
          // Database error, return database error feedback
          console.log(err);
          return res.status(500).send({
            feedback: process.env.FEEDBACK_DATABASE_ERROR,
          });
        } else if (result[0]) {
          // User found, check if the token is valid

          if (
            result[0].last_logout < user.iat &&
            result[0].created_at < user.iat
          ) {
            // Token issued after last logout and after user creation

            req.user = user;
            next();
          } else {
            // Token issued before last logout - therefore invalid

            return res.status(403).send({
              feedback: process.env.TOKEN_INACTIVE,
            });
          }
        }
      });
    }
  );
}

function authenticateAccessToken(req, res, next) {
    authenticateToken("access_token", req, res, next);
}

function authenticateRefreshToken(req, res, next) {
    authenticateToken("refresh_token", req, res, next);
}

function authenticateFirebaseToken(req, res, next) {
  // Function that authenticates the token that was provided
  // If the token is invalid, it returns

  const accessHeader = req.headers["firebase_token"];
  const token = accessHeader && accessHeader.split(" ")[1];

  // No token provided, reponse HTTP401
  if (token == null) return res.sendStatus(401);

  jwt.verify(
    token,
    serviceAccount.private_key,
    {
      algorithms: ["RS256"],
    },
    (errJWT, fbuser) => {
      // Token invalid (it was modified), response: HTTP403
      if (errJWT) {
        console.log(errJWT);
        return res.sendStatus(403);
      }

      // Token VALID, it was issued to user 'user.uid'

      // Validating token issued-at-wise
      const sqlSelect =
        "SELECT iduser, created_at, last_logout FROM user WHERE e_mail = ?";

      db.query(sqlSelect, [req.user.e_mail], (err, result) => {
        if (err) {
          // Database error, return database error feedback
          console.log(err);
          return res.status(500).send({
            feedback: process.env.FEEDBACK_DATABASE_ERROR,
          });
        } else if (result[0]) {
          // User found, check if the token is valid

          if (result[0].iduser != fbuser.uid) {
            // Firebase token does not belong to the user with access token
            return res.status(403).send({
              feedback: process.env.TOKEN_INVALID,
            });
          } else if (
            result[0].last_logout < fbuser.iat &&
            result[0].created_at < fbuser.iat
          ) {
            // Token issued after last logout and after user creation

            req.user.uid = fbuser.uid;
            next();
          } else {
            // Token issued before last logout - therefore invalid
            return res.status(403).send({
              feedback: process.env.TOKEN_INACTIVE,
            });
          }
        }
      });
    }
  );
}

module.exports = {
  generateAccessJWT,
  generateRefreshJWT,
  registerUserGenerateFirebaseJWT,
  generateFirebaseJWT,
  authenticateAccessToken,
  authenticateRefreshToken,
  authenticateFirebaseToken,
};
