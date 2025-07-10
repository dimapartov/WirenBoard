// -----------------------------------------------------------------------------
// *** Activate alarm if the controller has been rebooted ***
// -----------------------------------------------------------------------------
defineRule("checkForReboot", {
    when: cron("@every 10m"), // Every 10 minutes
    then: function() {
        if (dev["AuxReboot_virt/rebootFlag"] == "rebooted") {
            dev["SoundAlarm_virt/triggeredByReboot"] = true;
            dev["SoundAlarm_virt/isActive"] = true;
            SendTelegramMsg(0, "Уведомление. Контроллер был перезагружен");
        }
        dev["AuxReboot_virt/rebootFlag"] = "not rebooted";
    }
});