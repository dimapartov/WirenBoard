// -----------------------------------------------------------------------------
// *** Sound alarm settings (virtual device cells) ***
// -----------------------------------------------------------------------------
var soundAlarmCtrl_cells = {
    allowed: {
        title: "Разрешение сигнализации",
        type: "switch",
        value: true,
        readonly: false,
        order: 1,
    },
    roundTheClock: {
        title: "Круглосуточно",
        type: "switch",
        value: false,
        order: 2,
    },
    beginHH: {
        title: "Время начала: ЧЧ",
        type: "value",
        value: 17,
        readonly: false,
        order: 3,
    },
    beginMM: {
        title: "Время начала: ММ",
        type: "value",
        value: 0,
        readonly: false,
        order: 4,
    },
    endHH: {
        title: "Время окончания: ЧЧ",
        type: "value",
        value: 1,
        readonly: false,
        order: 5,
    },
    endMM: {
        title: "Время окончания: ММ",
        type: "value",
        value: 0,
        readonly: false,
        order: 6,
    },
    isActive: {
        title: "Активность сигнализации",
        type: "switch",
        value: false,
        readonly: true,
        order: 7,
    },
    reason: {
        title: "Причина срабатывания",
        type: "text",
        value: "test text",
        readonly: true,
        order: 8,
    },
    turnOffButton: {
        title: "Выключение сигнализации",
        type: "pushbutton",
        readonly: false,
        order: 9,
    },
    triggeredByLeakage: {
        title: "Включена по утечке",
        type: "switch",
        value: false,
        readonly: true,
        order: 10,
    },
    triggeredBySmoke: {
        title: "Включена по задымлению",
        type: "switch",
        value: false,
        readonly: true,
        order: 11,
    },
    triggeredByReboot: {
        title: "Включена по перезагрузке контроллера",
        type: "switch",
        value: false,
        readonly: true,
        order: 12,
    },
    triggeredByHumidity: {
        title: "Включена по влажности в душевой",
        type: "switch",
        value: false,
        readonly: true,
        order: 13,
    },
    triggeredOutsideInterval: {
        title: "Сработала вне разрешенного интервала",
        type: "switch",
        value: false,
        readonly: true,
        order: 14,
    },
};

defineVirtualDevice("VirtSoundAlarm", {
    title: "Звуковая сигнализация",
    cells: soundAlarmCtrl_cells
});

// Function for allowed time interval check
function isWithinAllowedInterval() {
    var currentDateTime = new Date();
    var startDateTime = new Date(currentDateTime);
    var endDateTime = new Date(currentDateTime);

    startDateTime.setHours(dev["VirtSoundAlarm/beginHH"]);
    startDateTime.setMinutes(dev["VirtSoundAlarm/beginMM"]);

    endDateTime.setHours(dev["VirtSoundAlarm/endHH"]);
    endDateTime.setMinutes(dev["VirtSoundAlarm/endMM"]);

    if (endDateTime < startDateTime) {
        endDateTime.setDate(endDateTime.getDate() + 1);
    }

    return ((currentDateTime >= startDateTime) && (currentDateTime <= endDateTime));
}

// Function for alarm activation
function activateAlarm() {
    dev["buzzer/enabled"] = true;
    SendTelegramMsg(1, "Активирована сигнализация!");

    switch (true) {
        case dev["VirtSoundAlarm/triggeredByLeakage"]:
            dev["VirtSoundAlarm/reason"] = "Утечка";
            break;
        case dev["VirtSoundAlarm/triggeredBySmoke"]:
            dev["VirtSoundAlarm/reason"] = "Задымление";
            break;
        case dev["VirtSoundAlarm/triggeredByReboot"]:
            dev["VirtSoundAlarm/reason"] = "Перезагрузка контроллера";
            break;
        case dev["VirtSoundAlarm/triggeredByHumidity"]:
            dev["VirtSoundAlarm/reason"] = "Влажность в душевой";
            break;
    }
}

// -----------------------------------------------------------------------------
// *** Sound alarm activation ***
// -----------------------------------------------------------------------------
defineRule("activateAlarm", {
    asSoonAs: function () {
        return dev["VirtSoundAlarm/isActive"];
    },
    then: function (newValue, devName, cellName) {
        if (dev["VirtSoundAlarm/allowed"] == true) {
            if (dev["VirtSoundAlarm/triggeredByLeakage"] == true || dev["VirtSoundAlarm/triggeredBySmoke"] == true) {
                activateAlarm();
            } else if (dev["VirtSoundAlarm/triggeredByReboot"] == true || dev["VirtSoundAlarm/triggeredByHumidity"] == true) {
                if (isWithinAllowedInterval() == true || dev["VirtSoundAlarm/roundTheClock"]) {
                    activateAlarm();
                } else {
                    dev["VirtSoundAlarm/triggeredOutsideInterval"] = true;
                }
            }
        } else {
            dev["VirtSoundAlarm/isActive"] = false;

            dev["VirtSoundAlarm/triggeredByLeakage"] = false;
            dev["VirtSoundAlarm/triggeredBySmoke"] = false;
            dev["VirtSoundAlarm/triggeredByReboot"] = false;
            dev["VirtSoundAlarm/triggeredByHumidity"] = false;
        }
    }
});

// -----------------------------------------------------------------------------
// *** Check time interval for delayed activation ***
// -----------------------------------------------------------------------------
defineRule("checkTimeInterval", {
    when: cron("@every 1m"), // Every minute
    then: function () {
        if (dev["VirtSoundAlarm/allowed"] == true && dev["VirtSoundAlarm/isActive"] == false) {
            if (isWithinAllowedInterval() == true || dev["VirtSoundAlarm/roundTheClock"]) {
                if (dev["VirtSoundAlarm/triggeredOutsideInterval"] = true) {
                    activateAlarm();
                    dev["VirtSoundAlarm/triggeredOutsideInterval"] = false;
                }
            }
        }
    }
});

// -----------------------------------------------------------------------------
// *** Sound alarm deactivation ***
// -----------------------------------------------------------------------------
defineRule("deactivateAlarm", {
    whenChanged: ["dev[VirtSoundAlarm/turnOffButton]", "dev[VirtSoundAlarm/allowed]"],
    then: function (newValue, devName, cellName) {
        if ((cellName == "turnOffButton" && newValue == true) || (cellName == "allowed" && newValue == false)) {
            dev["buzzer/enabled"] = false;
            dev["VirtSoundAlarm/isActive"] = false;

            SendTelegramMsg(1, "Сигнализация деактивирована");

            dev["VirtSoundAlarm/triggeredByLeakage"] = false;
            dev["VirtSoundAlarm/triggeredBySmoke"] = false;
            dev["VirtSoundAlarm/triggeredByReboot"] = false;
            dev["VirtSoundAlarm/triggeredByHumidity"] = false;

            dev["VirtSoundAlarm/reason"] = "Отсутствует";
        }
    }
});