defineRule("hourly_prowl_notification", {
    when: cron("0 0 * * * *"),
    then: function () {
        var Prowl = require("ProwlModule");
        Prowl.send("Тест!", "Текст тестового уведомления провл", 0);
    }
});