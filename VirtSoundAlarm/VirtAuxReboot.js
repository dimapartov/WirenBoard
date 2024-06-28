var auxReboot_cells = {
    timeFromLastReboot: {
        title: "Время с последней перезагрузки",
        type: "text",
        value: "12345",
        readonly: true,
        order: 1,
    },
};

defineVirtualDevice("AuxReboot", {
    title: "Время с последней перезагрузки",
    cells: auxReboot_cells
});

defineRule("checkForReboot", {
    when: cron("*/10 * * * * *"), // Every 10 seconds
    then: function() {
        var currentUptime = dev["wb-info/uptime"];

        if (currentUptime < dev["AuxReboot/timeFromLastReboot"]) {
            dev["VirtSoundAlarm/triggeredByReboot"] = true;
            dev["VirtSoundAlarm/isActive"] = true;
        }

        dev["AuxReboot/timeFromLastReboot"] = currentUptime;
    }
});