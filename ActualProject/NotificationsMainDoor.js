defineRule("doorOpenNotification", {
    whenChanged: "Entry Door Switch/contact",
    then: function (newValue) {
        if (newValue == "false") {
            SendTelegramMsg(1, "Уведомление. Дверь открыта");
        }
    }
});