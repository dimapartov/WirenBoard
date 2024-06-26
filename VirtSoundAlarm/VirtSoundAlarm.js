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
};

defineVirtualDevice('VirtSoundAlarm', {
    title: "Звуковая сигнализация",
    cells: soundAlarmCtrl_cells
});

// needs to be done //
defineRule("activateAlarm", {
    whenChanged: "dev[VirtSoundAlarm/isActive]",
    then: function (newValue, devName, cellName) {
        if (dev["VirtSoundAlarm/allowed"] == true) {

        }
    }
});