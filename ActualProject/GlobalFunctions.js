// -----------------------------------------------------------------------------
// *** Function for time interval check ***
// -----------------------------------------------------------------------------
global.__proto__.IsWithinAllowedInterval = function (beginHH, beginMM, endHH, endMM) {
    var currentDateTime = new Date();
    var startDateTime = new Date(currentDateTime);
    var endDateTime = new Date(currentDateTime);
    var midnightTransition = false;

    startDateTime.setHours(beginHH);
    startDateTime.setMinutes(beginMM);

    endDateTime.setHours(endHH);
    endDateTime.setMinutes(endMM);


    if (endDateTime < startDateTime) {
        endDateTime.setDate(endDateTime.getDate() + 1);
        midnightTransition = true;
    }

    if (currentDateTime >= startDateTime && currentDateTime <= endDateTime) {
        return true;
    }

    if ((midnightTransition == true && currentDateTime.getHours() < endHH) || (currentDateTime.getHours() == endHH && currentDateTime.getMinutes() <= endMM)) {
        return true;
    }

    return false;
}

// -----------------------------------------------------------------------------
// *** Function for sending telegram notifications ***
// -----------------------------------------------------------------------------
var postMsg = "curl -s -X POST https://api.telegram.org/bot_token_here/sendMessage -d chat_id='{}' -d text='{}'";
var users = [226353952, 770592984];
var admins = [254556808, 104577570];
global.__proto__.SendTelegramMsg = function (priority, msg) {
    for (var i = 0; i < admins.length; i++) {
        runShellCommand(postMsg.format(admins[i], msg));
    }
    if (priority == 1) {
        for (var i = 0; i < users.length; i++) {
            runShellCommand(postMsg.format(users[i], msg));
        }
    }
};