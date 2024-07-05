// -----------------------------------------------------------------------------
// *** Reboot auxiliary device settings (virtual device cells) ***
// -----------------------------------------------------------------------------
var AUX_REBOOT_CELLS = {
    rebootFlag: {
        title: "Флаг перезагрузки",
        type: "text",
        value: "rebooted",
        readonly: true,
        forceDefault: true,
        order: 1,
    },
};

// -----------------------------------------------------------------------------
// *** Humidity auxiliary device settings (virtual device cells) ***
// -----------------------------------------------------------------------------
var AUX_HUMIDITY_CELLS = {
    humidityThresholdHi: {
        title: "Максимальный порог влажности",
        type: "value",
        value: 70,
        readonly: false,
        order: 1,
    },
    humidityThresholdLo: {
        title: "Минимальный порог влажности",
        type: "value",
        value: 65,
        readonly: false,
        order: 2,
    },
};

// -----------------------------------------------------------------------------
// ***  Virtual devices ***
// -----------------------------------------------------------------------------
defineVirtualDevice("AuxReboot_virt", {
    title: "Время с последней перезагрузки",
    cells: AUX_REBOOT_CELLS
});

defineVirtualDevice("AuxHumidity_virt", {
    title: "Пороги влажности",
    cells: AUX_HUMIDITY_CELLS
});

// -----------------------------------------------------------------------------
// *** Activate alarm if the controller has been rebooted ***
// -----------------------------------------------------------------------------
defineRule("checkForReboot", {
    when: cron("@every 10m"), // Every 10 minutes
    then: function() {
        if (dev["AuxReboot_virt/rebootFlag"] == "rebooted") {
            dev["SoundAlarm_virt/triggeredByReboot"] = true
            dev["SoundAlarm_virt/isActive"] = true;
        }
        dev["AuxReboot_virt/rebootFlag"] = "not rebooted";
    }
});