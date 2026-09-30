// Three small helpers so controllers don't repeat themselves.
// There is no wrapper/envelope: the payload you pass IS the JSON body.
//
//   ok(res, { user })                ->  200  { "user": {...} }
//   created(res, { user: newUser })  ->  201  { "user": {...} }
//   throw httpError(404, 'no such user!')  ->  404  { "error": "no such user!" }
//
// Errors are turned into a response in ONE place: the error handler at the
// bottom of app.js. Every httpError() you throw lands there, so all error
// responses look identical without you having to write them by hand.

exports.ok = (res, data) => res.status(200).json(data);

exports.created = (res, data) => res.status(201).json(data);

// Build an error, don't send it. Throw it, and app.js's error handler
// renders it as { error: message } with your status code.
exports.httpError = (statusCode, message) => {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
};
