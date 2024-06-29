// -----------------------------------------------------------------------------
// *** Reboot auxiliary device settings (virtual device cells) ***
// -----------------------------------------------------------------------------
var auxReboot_cells = {
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
var auxHumidity_cells = {
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
defineVirtualDevice("AuxReboot", {
    title: "Время с последней перезагрузки",
    cells: auxReboot_cells
});

defineVirtualDevice("AuxHumidity", {
    title: "Пороги влажности",
    cells: auxHumidity_cells
});

// -----------------------------------------------------------------------------
// *** Activate alarm if the controller has been rebooted ***
// -----------------------------------------------------------------------------
defineRule("checkForReboot", {
    when: cron("@every 10m"), // Every 10 minutes
    then: function() {
        if (dev["AuxReboot/rebootFlag"] == "rebooted") {
            dev["VirtSoundAlarm/triggeredByReboot"] = true
            dev["VirtSoundAlarm/isActive"] = true;
        }
        dev["AuxReboot/rebootFlag"] = "not rebooted";
    }
});