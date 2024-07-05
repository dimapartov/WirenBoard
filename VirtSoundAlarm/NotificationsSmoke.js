defineRule("smokeNotification", {
    whenChanged: "Smoke sensor (шкаф в прихожке)/smoke",
    then: function (newValue) {
        if (newValue == "true") {
            SendTelegramMsg(1, "АВАРИЯ! Задымление в прихожей!");
            dev["SoundAlarm_virt/triggeredBySmoke"] = true;
            dev["SoundAlarm_virt/isActive"] = true;
        }
    }
});