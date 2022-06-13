// https://tudip.com/blog-post/how-to-send-push-notifications-to-android-devices-in-nodejs/

const FCM = require('fcm-node');

exports.androidPushNotification = (deviceToken, messageBody, type, callback) => {
    const serverKey = require("./.firebase/cropool-chat-firebase.json");
    const fcm = new FCM(serverKey); 
    const message = { 
        to: deviceToken, 
        collapse_key: 'Test notification', 
        notification: { 
            title: 'Test', 
            body: messageBody, 
            sound: 'ping.aiff', 
            delivery_receipt_requested: true
        },
        data: {
            message: messageBody,
            type: type
        }
    };
    fcm.send(message, callback);
};