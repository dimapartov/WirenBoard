var postMsg = "curl -s -X POST https://api.telegram.org/bot5175995984:AAFbasn2TirtYsW4BiCuCwB5tmbe6wiwGko/sendMessage -d chat_id='{}' -d text='{}'";
var users = [226353952, 770592984];
var admins = [254556808, 104577570];
global.__proto__.SendTelegramMsg = function (priority, msg) {
    for (var i = 0; i < admins.length; i++) {
        runShellCommand(postMsg.format(admins[i], msg));
    }
    if (priority === 1) {
        for (var i = 0; i < users.length; i++) {
            runShellCommand(postMsg.format(users[i], msg));
        }
    }
};