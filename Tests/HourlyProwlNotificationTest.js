var Prowl = require("ProwlModule");
defineRule("hourly_prowl_notification", {
//    when: cron("0 0 * * * *"),
    when: cron("0 15 10-22 * * *"),
    then: function () {
        Prowl.send("Тест!", "Каждый час текст тестового уведомления провл", 0);
    }
});