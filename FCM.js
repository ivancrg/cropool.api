var admin = require("firebase-admin");
// TODO process.env.FIREBASE_JSON_KEY_LOCATION
var serviceAccount = require("./.firebase/cropool-chat-firebase.json");

admin.initializeApp({
  	credential: admin.credential.cert(serviceAccount)
	//databaseURL: "https://prismappfcm.firebaseio.com"
});

var topic = 'general';
var message = {
  notification: {
    title: 'Message from node',
    body: 'Hey there'
  },
  topic: topic
};

admin.messaging().send(message)
  .then((response) => {
    console.log('Successfully sent message:', response);
  })
  .catch((error) => {
    console.log('Error sending message:', error);
});