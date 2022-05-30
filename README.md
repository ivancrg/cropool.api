# cropool.api

API for [cropool](https://github.com/MSrica/cropool) Android Application.

## Main

### `index.js`

Main file, run with `npm start`.

### Register

#### `/register`
POST. Expects JSON object with `first_name`, `last_name`, `e_mail`, hashed `password` objects. Short description:

* Tries to insert the new user specified by JSON object to the database:
    * On error: send response with HTTP 500 status and feedback string
    * On success:
        * If a user with the wanted e-mail address already exists: send response with HTTP 409 status and feedback string
        * If the wanted e-mail address isn't used by anyone: try to insert the new user specified by JSON object to the database:
            * On error: send response with HTTP 500 status and feedback string
            * On success: send response with HTTP 201 status, feedback string and header that includes access and refresh JWT tokens generated using [`generateAccessJWT`](#generate-access-token), [`generateRefreshJWT`](#generate-refresh-token) and [`generateFirebaseJWT`](#generate-firebase-token)

### Login

#### `/login`
POST. Expects JSON object with `e_mail` and `password` objects. Short description:

* Tries to get info of the user with e-mail address specified by JSON object:
    * On error: send response with HTTP 500 status and feedback string
    * On success:
        * If a user with the wanted e-mail address doesn't exist: send response with HTTP 404 status and feedback string
        * If a user with the wanted e-mail address exists: try to compare provided `password` with database's hashed password:
        * On error: send response with HTTP 500 status and feedback string
        * On success:
            * If the passwords match: send response with HTTP 201 status, feedback string and header that includes access and refresh JWT tokens generated using [`generateAccessJWT`](#generate-access-token), [`generateRefreshJWT`](#generate-refresh-token) and [`generateFirebaseJWT`](#generate-firebase-token)
            * If the passwords don't match: send response with HTTP 403 status and feedback string

### Logout

#### `/logout`
PATCH. Expects JSON object with `e_mail` object. Short description:

* Tries to update last logout timestamp of a user with `e_mail` e-mail address:
    * On error: send response with HTTP 500 status and feedback string
    * On success: send response with HTTP 201 status and feedback string

### Access token

#### `/accessToken`
GET. Expects `refresh_token` in request header. Short description:
* Checks whether the provided refresh JWT is valid using [`authenticateRefreshToken`](#authenticate-refresh-token):
    * If the token isn't valid: `token_management.js` middleware handles sending the response
    * If the token is valid: send response with HTTP 201 status, feedback string and header that includes access token in header generated by `token_management.js`



## Token management

### `token_management.js`
Used to store [JWT](https://jwt.io) utility functions.

### Generate access token

#### `generateAccessJWT(email)`
Generates access JWT that will belong to user with e-mail address `email` and will expire in 10 minutes.

### Generate refresh token

#### `generateRefreshJWT(email)`
Generates refresh JWT that will belong to user with e-mail address `email` and will expire in 7 days.

### Generate Firebase token

#### `generateFirebaseJWT(email, callback)`
Generates Firebase JWT that will belong to user with e-mail address `email` and will be used to authenticate with Firebase service.

### Authenticate access token

#### `authenticateAccessToken(req, res, next)`
Expects an access JWT in request's `access_token` header (format "Bearer \<token\>"). Middleware used for authenticating access tokens with API endpoints that respond with user-specific sensitive information. Short description:
* Checks whether the token is null:
    * If the token is null: send response with HTTP 401 status
    * If the token isn't null: check whether the token is valid:
        * If the token isn't valid: send response with HTTP 403 status
        * If the token is valid: forward `user` identified in token with `next()`

### Authenticate refresh token

#### `authenticateRefreshToken(req, res, next)`
Expects a refresh JWT in request's `refresh_token` header (format "Bearer \<token\>"). Middleware used for authenticating refresh tokens with API endpoint that issues new access tokens [`/accessToken`](#access-token). Short description:
* Checks whether the token is null:
    * If the token is null: send response with HTTP 401 status
    * If the token isn't null: check whether the token is valid:
        * If the token isn't valid: send response with HTTP 403 status
        * If the token is valid: check whether the token was issued after user's creation timestamp and user's last logout timestamp:
            * If the token was created before any of the mentioned timestamps: send response with HTTP 403 status and feedback string
            * If the token was created after both of the mentioned timestamps:  forward `user` identified in token with `next()`