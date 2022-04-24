const express = require("express");
const app = express();
const bodyParser = require("body-parser");
const cors = require("cors");
const mysql = require("mysql");
require("dotenv").config();

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
  const password = req.body.password;

  const sqlSelect = "SELECT * FROM users WHERE e_mail = ?";

  db.query(sqlSelect, [e_mail], (err, result) => {
    if (err) {
      // Database error
      res.send({ feedback: "database_error" });
      return;
    } else if (result[0]) {
      // User found, e_mail unavailable
      res.send({ feedback: "e_mail_unavailable" });
      return;
    } else {
      // User not found, no error in sqlSelect query
      const sqlInsert =
        "INSERT INTO users (first_name, last_name, e_mail, password) VALUES (?, ?, ?, ?)";

      db.query(
        sqlInsert,
        [first_name, last_name, e_mail, password],
        (err, result) => {
          if (err) {
            // Database error while inserting user
            res.send({ feedback: "database_error" });
            return;
          } else {
            // No error in sqlInsert query, user inserted
            res.send({ feedback: "user_registered" });
            return;
          }
        }
      );
    }
  });
});

app.listen(process.env.PORT || PORT, () => {
  console.log(`Running on port ${PORT}`);
});