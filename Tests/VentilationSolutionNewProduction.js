/*
 * ЛОГИКА РАБОТЫ ВЫТЯЖКИ В ВАННОЙ
 *
 * 1. Скрипт управляет вытяжным вентилятором по четырём источникам:
 *    - датчику влажности;
 *    - датчику движения;
 *    - концевику двери;
 *    - настенному пружинному выключателю.
 *
 * 2. Автоматический режим можно включать и выключать:
 *    - переключателем «Автоматический режим» в виртуальном устройстве;
 *    - длинным нажатием настенного выключателя продолжительностью от 3 секунд.
 *
 * 3. Работа по влажности построена с гистерезисом:
 *    - когда влажность достигает верхнего порога humidity_max, появляется
 *      требование включить вентиляцию;
 *    - после включения это требование сохраняется, пока влажность не снизится
 *      до нижнего порога humidity_min;
 *    - значения между двумя порогами не меняют текущее состояние требования.
 *
 *    Пример при порогах 70/60 %:
 *    - рост 50 -> 65 % не включает вентилятор;
 *    - рост до 70 % включает требование;
 *    - снижение 70 -> 65 % не снимает требование;
 *    - снижение до 60 % снимает требование.
 *
 * 4. Работа по двери и движению:
 *    - открытие двери всегда сбрасывает подтверждённое присутствие;
 *    - движение при закрытой двери подтверждает, что человек находится внутри;
 *    - пропадание движения при закрытой двери не считается выходом;
 *    - движение при открытой двери запоминается как возможный вход;
 *    - если после такого движения дверь закрылась не позднее чем через 30 секунд,
 *      присутствие подтверждается;
 *    - если дверь закрылась без свежего движения, помещение считается свободным;
 *    - данный источник можно полностью отключить переключателем
 *      «Управление по двери и движению».
 *
 * 5. Автоматические причины работают по принципу ИЛИ:
 *    - высокая влажность;
 *    - подтверждённое присутствие.
 *
 *    Пока активна хотя бы одна причина, автоматика требует работу вентилятора.
 *    Исчезновение одной причины не выключает вентилятор, если остаётся другая.
 *
 * 6. Задержки автоматики:
 *    - ON_DELAY применяется только к обычному автоматическому включению;
 *    - OFF_DELAY применяется после исчезновения последней автоматической причины;
 *    - если причина исчезла во время задержки включения, включение отменяется;
 *    - если причина появилась во время задержки выключения, выключение отменяется;
 *    - частые сообщения датчика влажности не перезапускают уже активный таймер.
 *
 * 7. Короткое нажатие настенного выключателя всегда переключает фактическое
 *    состояние вентилятора и имеет приоритет над обычной автоматикой:
 *    - если вентилятор выключен, он включается немедленно;
 *    - если вентилятор включён, он выключается немедленно;
 *    - автоматическая задержка включения или выключения при этом отменяется.
 *
 * 8. Ручной приоритет хранится в трёх состояниях:
 *    - ручного решения нет;
 *    - принудительно включено;
 *    - принудительно выключено.
 *
 *    Если кнопка была нажата во время активной автоматической причины,
 *    ручное решение действует до окончания этого автоматического цикла.
 *    Когда исчезает последняя автоматическая причина, временный ручной приоритет
 *    снимается, и следующий цикл снова может управляться автоматикой.
 *
 *    Пример:
 *    - влажность включила вентилятор;
 *    - пользователь коротким нажатием выключил его;
 *    - вентилятор остаётся выключенным, несмотря на активную влажность;
 *    - когда влажность снизилась до нижнего порога и других причин нет,
 *      ручной запрет автоматически снимается;
 *    - при следующем повышении влажности автоматика снова сможет включиться.
 *
 * 9. Защита от слишком долгого ручного выключения при высокой влажности:
 *    - если пользователь вручную выключил вентилятор;
 *    - автоматический режим включён;
 *    - фактическая влажность непрерывно остаётся не ниже humidity_max;
 *    - запускается отдельный защитный таймер;
 *    - его продолжительность задаётся параметром
 *      manual_off_humidity_timeout;
 *    - после завершения таймера ручной запрет снимается и вентилятор
 *      включается немедленно, без дополнительного ON_DELAY.
 *
 *    Защитный таймер сбрасывается, если:
 *    - влажность опустилась ниже верхнего порога;
 *    - пользователь снова нажал кнопку;
 *    - автоматический режим отключили;
 *    - исчезли все автоматические причины;
 *    - изменили продолжительность защитного таймера.
 *
 *    Если влажность после сброса снова достигнет верхнего порога,
 *    отсчёт начнётся заново с полного значения.
 *
 * 10. Ручное включение при отсутствии автоматических причин сохраняется до
 *     следующего короткого нажатия или до повторного включения автоматики.
 *     Это позволяет использовать вентилятор как обычный ручной.
 *
 * 11. При отключении автоматического режима:
 *     - все автоматические и защитные таймеры отменяются;
 *     - текущее состояние вентилятора сохраняется;
 *     - короткая кнопка напрямую включает и выключает вентилятор;
 *     - влажность, дверь и движение продолжают отслеживаться, но не меняют реле.
 *
 * 12. При повторном включении автоматического режима старое ручное состояние
 *     сбрасывается, текущие требования пересчитываются, и управление передаётся
 *     автоматике.
 *
 * 13. Если другой скрипт или внешняя команда изменит состояние реле,
 *     правило обратной связи повторно применит текущее решение:
 *     - ручной приоритет будет восстановлен;
 *     - либо автоматика снова запустит нужную задержку.
 */

var topics = {
    AI_HUMIDITY: "Humidity sensor-1 (БСУ, щит)/humidity",
    DI_WALL_SWITCH: "wb-gpio/EXT2_IN7",
    DI_DOOR_CLOSED: "Shower door switch/contact",
    DI_MOTION: "Motion sensor-2 (БСУ)/occupancy",
    DO_FAN: "wb-mr6c_209/K5"
};

var controls = {
    AUTO_MODE: "bathroom_fan/auto_mode",
    HUMIDITY_MAX: "bathroom_fan/humidity_max",
    HUMIDITY_MIN: "bathroom_fan/humidity_min",
    DOOR_MODE: "bathroom_fan/door_mode",
    ON_DELAY: "bathroom_fan/on_delay",
    OFF_DELAY: "bathroom_fan/off_delay",
    MANUAL_OFF_HUMIDITY_TIMEOUT:
        "bathroom_fan/manual_off_humidity_timeout"
};

var config = {
    ENTRY_CONFIRM_TIME_MS: 30000,
    SHORT_PRESS_MAX_MS: 1500,
    LONG_PRESS_MIN_MS: 3000,
    STARTUP_DELAY_MS: 2000
};

/*
 * Рабочее виртуальное устройство с настройками автоматики.
 * Значения сохраняются wb-rules между перезапусками, так как forceDefault
 * не используется.
 */
defineVirtualDevice("bathroom_fan", {
    title: "Управление вытяжкой",

    cells: {
        auto_mode: {
            title: "Автоматический режим",
            type: "switch",
            value: true
        },

        humidity_max: {
            title: "Порог включения по влажности, %",
            type: "range",
            value: 70,
            min: 30,
            max: 100
        },

        humidity_min: {
            title: "Порог выключения по влажности, %",
            type: "range",
            value: 60,
            min: 20,
            max: 95
        },

        door_mode: {
            title: "Управление по двери и движению",
            type: "switch",
            value: true
        },

        on_delay: {
            title: "Задержка автоматического включения, с",
            type: "range",
            value: 10,
            min: 0,
            max: 600
        },

        off_delay: {
            title: "Задержка автоматического выключения, с",
            type: "range",
            value: 300,
            min: 0,
            max: 3600
        },

        manual_off_humidity_timeout: {
            title: "Макс. ручное отключение при высокой влажности, с",
            type: "range",
            value: 600,
            min: 0,
            max: 7200
        }
    }
});

var state = {
    humidityDemand: false,
    presenceDemand: false,
    occupied: false,

    /*
     * null  — ручного приоритета нет;
     * true  — вентилятор принудительно включён;
     * false — вентилятор принудительно выключен.
     */
    manualOverride: null,

    /*
     * true означает, что ручной приоритет был задан во время активной
     * автоматической причины и должен исчезнуть после окончания этого цикла.
     */
    manualOverrideAutoCycle: false,

    lastMotionTime: 0,
    motionSeenSinceDoorOpened: false,
    buttonPressTime: 0,

    fanOnTimer: null,
    fanOffTimer: null,
    humiditySafetyTimer: null,

    thresholdsErrorLogged: false
};

/*
 * Преобразует значения дискретных MQTT-контролов к логическому типу.
 * Учитывает варианты true, 1, "1", "true" и "on".
 */
function toBoolean(value) {
    if (value === true || value === 1) {
        return true;
    }

    if (typeof value === "string") {
        value = value.toLowerCase();

        return value === "1" ||
            value === "true" ||
            value === "on";
    }

    return false;
}

/*
 * Преобразует значение аналогового контрола к числу.
 * Поддерживает дробные значения как с точкой, так и с запятой.
 */
function toNumber(value) {
    if (
        value === undefined ||
        value === null ||
        value === ""
    ) {
        return NaN;
    }

    if (typeof value === "string") {
        value = value.replace(",", ".");
    }

    return Number(value);
}

/*
 * Читает задержку из виртуального устройства и гарантирует неотрицательное
 * числовое значение. Ошибочные значения воспринимаются как нулевая задержка.
 */
function getDelaySeconds(controlName) {
    var delay = toNumber(dev[controlName]);

    if (isNaN(delay) || delay < 0) {
        return 0;
    }

    return delay;
}

/*
 * Возвращает итоговое автоматическое требование.
 * Вентиляция нужна, если активна влажность или подтверждено присутствие.
 */
function getAutomaticDemand() {
    return state.humidityDemand ||
        state.presenceDemand;
}

/*
 * Отменяет оба обычных автоматических таймера и очищает их состояния.
 */
function clearAutomaticTimers() {
    if (state.fanOnTimer !== null) {
        clearTimeout(state.fanOnTimer);
        state.fanOnTimer = null;
    }

    if (state.fanOffTimer !== null) {
        clearTimeout(state.fanOffTimer);
        state.fanOffTimer = null;
    }
}

/*
 * Отменяет все таймеры скрипта: включение, выключение и защиту по влажности.
 */
function clearAllTimers() {
    clearAutomaticTimers();

    if (state.humiditySafetyTimer !== null) {
        clearTimeout(state.humiditySafetyTimer);
        state.humiditySafetyTimer = null;
    }
}

/*
 * Переключает физическое реле только тогда, когда его текущее состояние
 * отличается от требуемого. Это уменьшает лишние записи в MQTT-контрол.
 */
function setFanState(newState) {
    newState = toBoolean(newState);

    if (
        toBoolean(dev[topics.DO_FAN]) !==
        newState
    ) {
        dev[topics.DO_FAN] = newState;
    }
}

/*
 * Проверяет, находится ли фактическая влажность не ниже верхнего порога.
 * Одновременно проверяет корректность обоих порогов гистерезиса.
 */
function isHumidityAtOrAboveUpperThreshold() {
    var humidity = toNumber(
        dev[topics.AI_HUMIDITY]
    );

    var humidityMax = toNumber(
        dev[controls.HUMIDITY_MAX]
    );

    var humidityMin = toNumber(
        dev[controls.HUMIDITY_MIN]
    );

    return !isNaN(humidity) &&
        !isNaN(humidityMax) &&
        !isNaN(humidityMin) &&
        humidityMin < humidityMax &&
        humidity >= humidityMax;
}

/*
 * Синхронизирует защитный таймер ручного выключения при высокой влажности.
 *
 * Таймер запускается только при одновременном выполнении трёх условий:
 * - автоматический режим включён;
 * - действует ручное принудительное выключение;
 * - влажность непрерывно находится не ниже верхнего порога.
 *
 * Частые показания влажности не перезапускают уже идущий отсчёт.
 * При исчезновении любого условия таймер немедленно отменяется.
 */
function syncHumiditySafetyTimer() {
    var timerRequired =
        toBoolean(dev[controls.AUTO_MODE]) &&
        state.manualOverride === false &&
        isHumidityAtOrAboveUpperThreshold();

    if (!timerRequired) {
        if (state.humiditySafetyTimer !== null) {
            clearTimeout(state.humiditySafetyTimer);
            state.humiditySafetyTimer = null;
        }

        return;
    }

    if (state.humiditySafetyTimer !== null) {
        return;
    }

    var delaySeconds = getDelaySeconds(
        controls.MANUAL_OFF_HUMIDITY_TIMEOUT
    );

    if (delaySeconds === 0) {
        state.manualOverride = null;
        state.manualOverrideAutoCycle = false;
        clearAutomaticTimers();
        setFanState(true);
        return;
    }

    state.humiditySafetyTimer =
        setTimeout(function () {
            state.humiditySafetyTimer = null;

            var conditionsStillValid =
                toBoolean(dev[controls.AUTO_MODE]) &&
                state.manualOverride === false &&
                isHumidityAtOrAboveUpperThreshold();

            if (!conditionsStillValid) {
                return;
            }

            state.manualOverride = null;
            state.manualOverrideAutoCycle = false;
            clearAutomaticTimers();

            /*
             * Защитный таймер уже является выдержкой времени, поэтому
             * дополнительная задержка автоматического включения не применяется.
             */
            setFanState(true);
        }, delaySeconds * 1000);
}

/*
 * Запускает автоматическое включение с заданной задержкой.
 * Повторные события не создают второй таймер и не начинают отсчёт заново.
 * Перед фактическим включением все условия проверяются повторно.
 */
function requestAutomaticFanOn() {
    if (state.fanOffTimer !== null) {
        clearTimeout(state.fanOffTimer);
        state.fanOffTimer = null;
    }

    if (
        state.manualOverride !== null ||
        toBoolean(dev[topics.DO_FAN])
    ) {
        if (state.fanOnTimer !== null) {
            clearTimeout(state.fanOnTimer);
            state.fanOnTimer = null;
        }

        return;
    }

    if (state.fanOnTimer !== null) {
        return;
    }

    var delaySeconds = getDelaySeconds(
        controls.ON_DELAY
    );

    if (delaySeconds === 0) {
        if (
            toBoolean(dev[controls.AUTO_MODE]) &&
            state.manualOverride === null &&
            getAutomaticDemand()
        ) {
            setFanState(true);
        }

        return;
    }

    state.fanOnTimer =
        setTimeout(function () {
            state.fanOnTimer = null;

            if (
                toBoolean(dev[controls.AUTO_MODE]) &&
                state.manualOverride === null &&
                getAutomaticDemand()
            ) {
                setFanState(true);
            }
        }, delaySeconds * 1000);
}

/*
 * Запускает автоматическое выключение с заданной задержкой.
 * Если до окончания отсчёта снова появляется причина для работы,
 * таймер отменяется в общей функции согласования состояния.
 */
function requestAutomaticFanOff() {
    if (state.fanOnTimer !== null) {
        clearTimeout(state.fanOnTimer);
        state.fanOnTimer = null;
    }

    if (
        state.manualOverride !== null ||
        !toBoolean(dev[topics.DO_FAN])
    ) {
        if (state.fanOffTimer !== null) {
            clearTimeout(state.fanOffTimer);
            state.fanOffTimer = null;
        }

        return;
    }

    if (state.fanOffTimer !== null) {
        return;
    }

    var delaySeconds = getDelaySeconds(
        controls.OFF_DELAY
    );

    if (delaySeconds === 0) {
        if (
            toBoolean(dev[controls.AUTO_MODE]) &&
            state.manualOverride === null &&
            !getAutomaticDemand()
        ) {
            setFanState(false);
        }

        return;
    }

    state.fanOffTimer =
        setTimeout(function () {
            state.fanOffTimer = null;

            if (
                toBoolean(dev[controls.AUTO_MODE]) &&
                state.manualOverride === null &&
                !getAutomaticDemand()
            ) {
                setFanState(false);
            }
        }, delaySeconds * 1000);
}

/*
 * Согласует фактическое состояние вентилятора со всеми текущими условиями.
 *
 * Приоритеты:
 * 1. отключённый автоматический режим — обычная автоматика не управляет реле;
 * 2. ручной приоритет — реле принудительно удерживается в выбранном состоянии;
 * 3. автоматические требования — применяются ON_DELAY и OFF_DELAY.
 */
function reconcileFanControl() {
    if (!toBoolean(dev[controls.AUTO_MODE])) {
        clearAllTimers();

        /*
         * В ручном режиме выбранное состояние также защищается от случайного
         * изменения другим правилом или внешней MQTT-командой.
         */
        if (state.manualOverride !== null) {
            setFanState(state.manualOverride);
        }

        return;
    }

    if (state.manualOverride !== null) {
        clearAutomaticTimers();
        setFanState(state.manualOverride);
        syncHumiditySafetyTimer();
        return;
    }

    if (state.humiditySafetyTimer !== null) {
        clearTimeout(state.humiditySafetyTimer);
        state.humiditySafetyTimer = null;
    }

    if (getAutomaticDemand()) {
        requestAutomaticFanOn();
    } else {
        requestAutomaticFanOff();
    }
}

/*
 * После изменения влажности или присутствия проверяет, закончился ли
 * автоматический цикл, в котором пользователь задал ручной приоритет.
 *
 * Если последняя автоматическая причина исчезла, временный ручной приоритет
 * снимается, после чего управление снова передаётся обычной автоматике.
 */
function handleAutomaticDemandChange(
    previousAutomaticDemand
) {
    var currentAutomaticDemand =
        getAutomaticDemand();

    if (
        state.manualOverride !== null &&
        state.manualOverrideAutoCycle &&
        !currentAutomaticDemand
    ) {
        state.manualOverride = null;
        state.manualOverrideAutoCycle = false;

        if (state.humiditySafetyTimer !== null) {
            clearTimeout(state.humiditySafetyTimer);
            state.humiditySafetyTimer = null;
        }

        reconcileFanControl();
        return;
    }

    syncHumiditySafetyTimer();

    if (
        previousAutomaticDemand !==
        currentAutomaticDemand
    ) {
        reconcileFanControl();
    }
}

/*
 * Пересчитывает требование по влажности с гистерезисом.
 *
 * При некорректных порогах или отсутствии данных датчика текущее требование
 * не сбрасывается, чтобы не произошло неожиданного выключения вентиляции.
 * Функция возвращает true только при фактическом изменении требования.
 */
function refreshHumidityDemand() {
    var humidity = toNumber(
        dev[topics.AI_HUMIDITY]
    );

    var humidityMax = toNumber(
        dev[controls.HUMIDITY_MAX]
    );

    var humidityMin = toNumber(
        dev[controls.HUMIDITY_MIN]
    );

    if (
        isNaN(humidityMax) ||
        isNaN(humidityMin) ||
        humidityMin >= humidityMax
    ) {
        if (!state.thresholdsErrorLogged) {
            log(
                "bathroom_fan: неверные пороги влажности: " +
                "min={}, max={}",
                humidityMin,
                humidityMax
            );

            state.thresholdsErrorLogged = true;
        }

        return false;
    }

    state.thresholdsErrorLogged = false;

    if (isNaN(humidity)) {
        return false;
    }

    var previousHumidityDemand =
        state.humidityDemand;

    if (humidity >= humidityMax) {
        state.humidityDemand = true;
    } else if (humidity <= humidityMin) {
        state.humidityDemand = false;
    }

    return previousHumidityDemand !==
        state.humidityDemand;
}

/*
 * Обрабатывает новое показание влажности или изменение её порогов.
 *
 * Даже если гистерезисное требование не изменилось, защитный таймер всё равно
 * синхронизируется, потому что для него важно непрерывное нахождение именно
 * выше верхнего порога, а не только сохранённый флаг humidityDemand.
 */
function processHumidityChange() {
    var previousAutomaticDemand =
        getAutomaticDemand();

    var demandChanged =
        refreshHumidityDemand();

    if (!demandChanged) {
        syncHumiditySafetyTimer();
        return;
    }

    handleAutomaticDemandChange(
        previousAutomaticDemand
    );
}

/*
 * Устанавливает подтверждённое присутствие и пересчитывает требование
 * по двери и движению. После изменения согласует его с влажностью,
 * ручным приоритетом и текущими таймерами.
 */
function setOccupied(newState) {
    var previousAutomaticDemand =
        getAutomaticDemand();

    state.occupied =
        toBoolean(newState);

    state.presenceDemand =
        toBoolean(dev[controls.DOOR_MODE]) &&
        toBoolean(dev[topics.DI_DOOR_CLOSED]) &&
        state.occupied;

    handleAutomaticDemandChange(
        previousAutomaticDemand
    );
}

/*
 * Выполняет короткое ручное нажатие.
 *
 * Кнопка всегда переключает реальное состояние реле и отменяет все таймеры.
 * В автоматическом режиме создаётся ручной приоритет, способный принудительно
 * удерживать как включённое, так и выключенное состояние.
 */
function applyManualButtonAction() {
    var targetFanState =
        !toBoolean(dev[topics.DO_FAN]);

    var automaticDemand =
        getAutomaticDemand();

    clearAllTimers();

    if (!toBoolean(dev[controls.AUTO_MODE])) {
        state.manualOverride =
            targetFanState;

        state.manualOverrideAutoCycle =
            false;

        setFanState(targetFanState);
        return;
    }

    /*
     * Если вентилятор вручную выключается при отсутствии автоматических причин,
     * постоянный запрет не нужен: достаточно немедленно выключить реле.
     */
    if (
        !targetFanState &&
        !automaticDemand
    ) {
        state.manualOverride = null;
        state.manualOverrideAutoCycle = false;
        setFanState(false);
        return;
    }

    state.manualOverride =
        targetFanState;

    state.manualOverrideAutoCycle =
        automaticDemand;

    setFanState(targetFanState);
    syncHumiditySafetyTimer();
}

/*
 * Обрабатывает включение и выключение автоматического режима.
 *
 * При отключении сохраняет текущее состояние вентилятора как ручное.
 * При включении сбрасывает старый ручной приоритет, пересчитывает текущую
 * влажность и передаёт управление автоматике.
 */
function handleAutoModeChange(enabled) {
    clearAllTimers();

    if (!toBoolean(enabled)) {
        state.manualOverride =
            toBoolean(dev[topics.DO_FAN]);

        state.manualOverrideAutoCycle =
            false;

        return;
    }

    state.manualOverride = null;
    state.manualOverrideAutoCycle = false;

    refreshHumidityDemand();

    state.presenceDemand =
        toBoolean(dev[controls.DOOR_MODE]) &&
        toBoolean(dev[topics.DI_DOOR_CLOSED]) &&
        state.occupied;

    reconcileFanControl();
}

/*
 * Реагирует только на изменение показаний датчика влажности.
 * Частые сообщения не затрагивают дверь, движение и кнопку.
 */
defineRule("bathroom_fan_humidity", {
    whenChanged: topics.AI_HUMIDITY,

    then: function () {
        processHumidityChange();
    }
});

/*
 * Пересчитывает влажность при изменении верхнего или нижнего порога.
 */
defineRule("bathroom_fan_humidity_settings", {
    whenChanged: [
        controls.HUMIDITY_MAX,
        controls.HUMIDITY_MIN
    ],

    then: function () {
        processHumidityChange();
    }
});

/*
 * При изменении допустимого времени ручного выключения перезапускает
 * активный защитный отсчёт с новым полным значением.
 */
defineRule("bathroom_fan_humidity_safety_timeout", {
    whenChanged:
        controls.MANUAL_OFF_HUMIDITY_TIMEOUT,

    then: function () {
        if (state.humiditySafetyTimer !== null) {
            clearTimeout(state.humiditySafetyTimer);
            state.humiditySafetyTimer = null;
        }

        syncHumiditySafetyTimer();
    }
});

/*
 * Обрабатывает датчик движения.
 *
 * Пропадание движения не означает выход.
 * Движение при открытой двери запоминается для подтверждения входа,
 * а движение при закрытой двери сразу подтверждает присутствие.
 */
defineRule("bathroom_fan_motion", {
    whenChanged: topics.DI_MOTION,

    then: function (newValue) {
        if (!toBoolean(newValue)) {
            return;
        }

        state.lastMotionTime =
            Date.now();

        if (!toBoolean(dev[controls.DOOR_MODE])) {
            return;
        }

        if (!toBoolean(dev[topics.DI_DOOR_CLOSED])) {
            state.motionSeenSinceDoorOpened =
                true;

            return;
        }

        setOccupied(true);
    }
});

/*
 * Обрабатывает концевик двери.
 *
 * Открытие двери сбрасывает присутствие.
 * Закрытие подтверждает новый вход только при наличии свежего движения,
 * зарегистрированного после открытия двери и не старше 30 секунд.
 */
defineRule("bathroom_fan_door", {
    whenChanged: topics.DI_DOOR_CLOSED,

    then: function (newValue) {
        var doorClosed =
            toBoolean(newValue);

        if (!doorClosed) {
            state.motionSeenSinceDoorOpened =
                false;

            setOccupied(false);
            return;
        }

        if (!toBoolean(dev[controls.DOOR_MODE])) {
            setOccupied(false);
            return;
        }

        var entryConfirmed =
            state.motionSeenSinceDoorOpened &&
            state.lastMotionTime > 0 &&
            Date.now() - state.lastMotionTime <=
                config.ENTRY_CONFIRM_TIME_MS;

        state.motionSeenSinceDoorOpened =
            false;

        setOccupied(entryConfirmed);
    }
});

/*
 * Включает или отключает использование двери и движения.
 *
 * При отключении присутствие полностью сбрасывается.
 * При включении закрытая дверь и активное движение считаются подтверждённым
 * присутствием; во всех остальных случаях помещение считается свободным.
 */
defineRule("bathroom_fan_door_mode", {
    whenChanged: controls.DOOR_MODE,

    then: function (newValue) {
        if (!toBoolean(newValue)) {
            setOccupied(false);
            return;
        }

        setOccupied(
            toBoolean(dev[topics.DI_DOOR_CLOSED]) &&
            toBoolean(dev[topics.DI_MOTION])
        );
    }
});

/*
 * При изменении задержек отменяет старые автоматические таймеры и создаёт
 * новый отсчёт согласно текущему состоянию и новым значениям.
 */
defineRule("bathroom_fan_delays", {
    whenChanged: [
        controls.ON_DELAY,
        controls.OFF_DELAY
    ],

    then: function () {
        clearAutomaticTimers();
        reconcileFanControl();
    }
});

/*
 * Обрабатывает переключатель автоматического режима виртуального устройства.
 */
defineRule("bathroom_fan_auto_mode", {
    whenChanged: controls.AUTO_MODE,

    then: function (newValue) {
        handleAutoModeChange(newValue);
    }
});

/*
 * Различает короткое и длинное нажатие настенного пружинного выключателя.
 *
 * До 1,5 секунды включительно — ручное переключение вентилятора.
 * От 3 секунд — переключение автоматического режима.
 * Промежуток от 1,5 до 3 секунд намеренно игнорируется.
 */
defineRule("bathroom_fan_button", {
    whenChanged: topics.DI_WALL_SWITCH,

    then: function (newValue) {
        if (toBoolean(newValue)) {
            state.buttonPressTime =
                Date.now();

            return;
        }

        if (state.buttonPressTime === 0) {
            return;
        }

        var pressDuration =
            Date.now() -
            state.buttonPressTime;

        state.buttonPressTime = 0;

        if (
            pressDuration <=
            config.SHORT_PRESS_MAX_MS
        ) {
            applyManualButtonAction();
            return;
        }

        if (
            pressDuration >=
            config.LONG_PRESS_MIN_MS
        ) {
            dev[controls.AUTO_MODE] =
                !toBoolean(
                    dev[controls.AUTO_MODE]
                );
        }
    }
});

/*
 * Контролирует внешние изменения реле.
 * Если реле переключил другой скрипт, интерфейс или внешняя команда,
 * текущий ручной приоритет либо автоматика будут применены повторно.
 */
defineRule("bathroom_fan_relay_feedback", {
    whenChanged: topics.DO_FAN,

    then: function () {
        reconcileFanControl();
    }
});

/*
 * Выполняет первоначальную инициализацию после запуска wb-rules.
 *
 * Читает фактические датчики, восстанавливает требования и затем:
 * - в автоматическом режиме передаёт управление автоматике;
 * - в ручном режиме сохраняет текущее состояние реле.
 */
function initializeController() {
    clearAllTimers();

    var humidity = toNumber(
        dev[topics.AI_HUMIDITY]
    );

    var humidityMax = toNumber(
        dev[controls.HUMIDITY_MAX]
    );

    var humidityMin = toNumber(
        dev[controls.HUMIDITY_MIN]
    );

    if (
        !isNaN(humidity) &&
        !isNaN(humidityMax) &&
        !isNaN(humidityMin) &&
        humidityMin < humidityMax
    ) {
        if (humidity >= humidityMax) {
            state.humidityDemand = true;
        } else if (humidity <= humidityMin) {
            state.humidityDemand = false;
        }
    }

    if (toBoolean(dev[topics.DI_MOTION])) {
        state.lastMotionTime =
            Date.now();
    }

    state.occupied =
        toBoolean(dev[controls.DOOR_MODE]) &&
        toBoolean(dev[topics.DI_DOOR_CLOSED]) &&
        toBoolean(dev[topics.DI_MOTION]);

    state.presenceDemand =
        state.occupied;

    state.motionSeenSinceDoorOpened =
        false;

    state.buttonPressTime =
        0;

    if (toBoolean(dev[controls.AUTO_MODE])) {
        state.manualOverride = null;
        state.manualOverrideAutoCycle = false;
        reconcileFanControl();
    } else {
        state.manualOverride =
            toBoolean(dev[topics.DO_FAN]);

        state.manualOverrideAutoCycle =
            false;
    }
}

setTimeout(
    initializeController,
    config.STARTUP_DELAY_MS
);