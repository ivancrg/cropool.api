var admin = require("firebase-admin");

var serviceAccount = require(process.env.FIREBASE_JSON_KEY_LOCATION);

title = "title";
body = "body";
const topic = "notifications";
const registrationToken =
  "e4jj44L7QqGOvGsmgg9QdH:APA91bE-zcXWY8nRwVsUNON0GAIffGQmFpsi9AiGqJU6qbcuxgan_lfIqZpUW4LCT0rtVL8GbeExt2vMvprrr3GzUYoR-Z4T3n388NIPaU3_ATIm1wRmxzUeo5SKuAu-rXqgRpqtHf00";
console.log(registrationToken, topic, title, body);

var message = {
  data: {
    title: title,
    body: body,
  },
  tokens: [registrationToken],
};

admin
  .messaging()
  .send(message)
  .then((response) => {
    // console.log("Successfully sent message:", response);
  })
  .catch((error) => {
    console.log("Error sending message to ", toID, title, body);
    console.log(error);
  });
