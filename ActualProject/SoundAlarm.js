// -----------------------------------------------------------------------------
// *** Sound alarm settings (virtual device cells) ***
// -----------------------------------------------------------------------------
var SOUND_ALARM_CTRL_CELLS = {
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

defineVirtualDevice("SoundAlarm_virt", {
    title: "Звуковая сигнализация",
    cells: SOUND_ALARM_CTRL_CELLS
});

// -----------------------------------------------------------------------------
// *** Function for sound alarm activation ***
// -----------------------------------------------------------------------------
function activateAlarm() {
    dev["buzzer/enabled"] = true;
    SendTelegramMsg(1, "Активирована сигнализация!");

    switch (true) {
        case dev["SoundAlarm_virt/triggeredByLeakage"]:
            dev["SoundAlarm_virt/reason"] = "Утечка";
            break;
        case dev["SoundAlarm_virt/triggeredBySmoke"]:
            dev["SoundAlarm_virt/reason"] = "Задымление";
            break;
        case dev["SoundAlarm_virt/triggeredByReboot"]:
            dev["SoundAlarm_virt/reason"] = "Перезагрузка контроллера";
            break;
        case dev["SoundAlarm_virt/triggeredByHumidity"]:
            dev["SoundAlarm_virt/reason"] = "Влажность в душевой";
            break;
        default:
            dev["SoundAlarm_virt/reason"] = "Не определено";
    }
}

// -----------------------------------------------------------------------------
// *** Sound alarm activation ***
// -----------------------------------------------------------------------------
defineRule("activateAlarm", {
    asSoonAs: function () {
        return dev["SoundAlarm_virt/isActive"];
    },
    then: function (newValue, devName, cellName) {
        if (dev["SoundAlarm_virt/allowed"] == true) {
            if (dev["SoundAlarm_virt/triggeredByLeakage"] == true || dev["SoundAlarm_virt/triggeredBySmoke"] == true) {
                activateAlarm();
            } else if (dev["SoundAlarm_virt/triggeredByReboot"] == true || dev["SoundAlarm_virt/triggeredByHumidity"] == true) {
                if (IsWithinAllowedInterval(dev["SoundAlarm_virt/beginHH"],
                                            dev["SoundAlarm_virt/beginMM"],
                                            dev["SoundAlarm_virt/endHH"],
                                            dev["SoundAlarm_virt/endMM"]) == true || dev["SoundAlarm_virt/roundTheClock"] == true) {
                    activateAlarm();
                } else {
                    dev["SoundAlarm_virt/triggeredOutsideInterval"] = true;
                    dev["SoundAlarm_virt/isActive"] = false;
                }
            }
        } else {
            dev["SoundAlarm_virt/isActive"] = false;

            dev["SoundAlarm_virt/triggeredByLeakage"] = false;
            dev["SoundAlarm_virt/triggeredBySmoke"] = false;
            dev["SoundAlarm_virt/triggeredByReboot"] = false;
            dev["SoundAlarm_virt/triggeredByHumidity"] = false;
        }
    }
});

// -----------------------------------------------------------------------------
// *** Check time interval for delayed activation ***
// -----------------------------------------------------------------------------
defineRule("checkTimeInterval", {
    when: cron("@every 1m"), // Every minute
    then: function () {
        if (dev["SoundAlarm_virt/allowed"] == true) {
            if (IsWithinAllowedInterval(dev["SoundAlarm_virt/beginHH"],
                                        dev["SoundAlarm_virt/beginMM"],
                                        dev["SoundAlarm_virt/endHH"],
                                        dev["SoundAlarm_virt/endMM"]) == true || dev["SoundAlarm_virt/roundTheClock"] == true) {
                if (dev["SoundAlarm_virt/triggeredOutsideInterval"] == true) {
                    dev["SoundAlarm_virt/isActive"] = true;
                    dev["SoundAlarm_virt/triggeredOutsideInterval"] = false;
                }
            }
        }
    }
});

// -----------------------------------------------------------------------------
// *** Sound alarm reset/deactivation ***
// -----------------------------------------------------------------------------
defineRule("deactivateAlarm", {
    whenChanged: ["SoundAlarm_virt/turnOffButton", "SoundAlarm_virt/allowed"],
    then: function (newValue, devName, cellName) {
        if ((cellName == "turnOffButton" && dev["SoundAlarm_virt/isActive"] == true) || (cellName == "allowed" && newValue == false)) {
            dev["buzzer/enabled"] = false;
            dev["SoundAlarm_virt/isActive"] = false;

            var message = "";
            if (cellName == "allowed") {
                message = "Сигнализация запрещена";
            } else if (cellName == "turnOffButton") {
                message = "Сигнализация подтверждена";
            } else {
                message = "Неизвестное событие сигнализации";
            }
            SendTelegramMsg(1, message);

            dev["SoundAlarm_virt/triggeredByLeakage"] = false;
            dev["SoundAlarm_virt/triggeredBySmoke"] = false;
            dev["SoundAlarm_virt/triggeredByReboot"] = false;
            dev["SoundAlarm_virt/triggeredByHumidity"] = false;

            dev["SoundAlarm_virt/reason"] = "Отсутствует";
        }
    }
});