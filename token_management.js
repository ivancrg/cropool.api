const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const saltRounds = 10;
const mysql = require("mysql");
require("dotenv").config();

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  multipleStatements: true,
});

function generateAccessJWT(email) {
  return jwt.sign({ e_mail: email }, process.env.ACCESS_TOKEN_SECRET, {
    expiresIn: "10m",
  });
}

function generateRefreshJWT(email) {
  return jwt.sign({ e_mail: email }, process.env.REFRESH_TOKEN_SECRET, {
    expiresIn: "7d",
  });
}

function authenticateAccessToken(req, res, next) {
  // Function that authenticates the token that was provided
  // If the token is invalid, it returns

  const accessHeader = req.headers["access_token"];
  const token = accessHeader && accessHeader.split(" ")[1];

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

function authenticateRefreshToken(req, res, next) {
  // Function that authenticates the refresh token that was provided
  // The function also checks whether the token is active (issued after last logout timestamp)
  // (If the user has logged out, all of his refresh tokens were invalidated)

  const refreshHeader = req.headers["refresh_token"];
  const token = refreshHeader && refreshHeader.split(" ")[1];

  // No token provided, reponse HTTP401
  if (token == null) return res.sendStatus(401);

  jwt.verify(token, process.env.REFRESH_TOKEN_SECRET, (err, user) => {
    // Token invalid (it was modified), response: HTTP403
    if (err) return res.sendStatus(403);

    // Token VALID, it was issued to user 'user.e_mail'

    // Validating token issued-at-wise
    const sqlSelect = "SELECT created_at, last_logout FROM user WHERE e_mail = ?";

    db.query(sqlSelect, [user.e_mail], (err, result) => {
      if (err) {
        // Database error, return database error feedback
        console.log(err)
        return res.status(500).send({
          feedback: process.env.FEEDBACK_DATABASE_ERROR,
        });
      } else if (result[0]) {
        // User found, check if the token is valid

        if (result[0].last_logout < user.iat && result[0].created_at < user.iat) {
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
  });
}

module.exports = {
  generateAccessJWT,
  generateRefreshJWT,
  authenticateAccessToken,
  authenticateRefreshToken,
};
