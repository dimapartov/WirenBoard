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

defineVirtualDevice("AuxReboot", {
    title: "Время с последней перезагрузки",
    cells: auxReboot_cells
});

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