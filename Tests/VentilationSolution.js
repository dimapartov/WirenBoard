/*
 * ЛОГИКА РАБОТЫ ВЫТЯЖКИ В ВАННОЙ
 *
 * 1. Скрипт управляет вытяжным вентилятором по пяти источникам:
 *    - датчику влажности;
 *    - датчику движения;
 *    - концевику двери;
 *    - настенному пружинному выключателю;
 *    - виртуальному переключателю «Вентилятор».
 *
 * 2. Автоматический режим можно включать и выключать:
 *    - переключателем «Автоматический режим» в виртуальном устройстве;
 *    - длинным нажатием настенного выключателя продолжительностью от 3 секунд.
 *
 * 3. Работа по влажности построена с гистерезисом:
 *    - humidity >= humidity_max — требование включения;
 *    - humidity <= humidity_min — требование снимается;
 *    - между порогами состояние сохраняется.
 *
 * 4. Работа по двери и движению:
 *    - открытие двери сбрасывает присутствие;
 *    - движение при закрытой двери подтверждает присутствие;
 *    - пропадание движения не считается выходом;
 *    - движение при открытой двери запоминается как возможный вход;
 *    - закрытие двери в течение 30 секунд после движения подтверждает вход.
 *
 * 5. Автоматические причины объединяются по ИЛИ:
 *    - высокая влажность;
 *    - подтверждённое присутствие.
 *
 * 6. Все пользовательские выдержки задаются в минутах
 *    и переводятся внутри скрипта в миллисекунды.
 *
 * 7. Короткое нажатие настенной кнопки и виртуальный переключатель
 *    используют общий механизм ручного управления.
 *
 * 8. Виртуальный переключатель «Вентилятор» также отображает
 *    фактическое состояние физического реле.
 *
 * 9. Ручной приоритет:
 *    - null  — отсутствует;
 *    - true  — принудительно включено;
 *    - false — принудительно выключено.
 *
 * 10. При разрешённой защите ручное OFF при высокой влажности
 *     ограничивается защитным таймером.
 *
 * 11. При отключённой автоматике вентилятор работает в ручном режиме.
 *
 * 12. После повторного включения автоматики старый ручной приоритет
 *     сбрасывается и выполняется новый расчёт состояния.
 *
 * 13. Внешнее изменение физического реле обнаруживается через обратную связь.
 *
 * 14. Нештатные состояния записываются в журнал:
 *     - ERROR   — управление невозможно или данные критически некорректны;
 *     - WARNING — подозрительное или временно некорректное состояние;
 *     - INFO    — восстановление после ошибки и важные изменения режима;
 *     - DEBUG   — запуск/отмена таймеров и служебные переходы.
 */
var topics = {
    AI_HUMIDITY: "Humidity sensor-2 (БСУ, помещение)/humidity",
    DI_WALL_SWITCH: "wb-gpio/EXT2_IN7",
    DI_DOOR_CLOSED: "Shower door switch/contact",
    DI_MOTION: "Motion sensor-2 (БСУ)/occupancy",
    DO_FAN: "wb-mr6c_209/K5"
};
var controls = {
    FAN_SWITCH: "bathroom_fan/fan_switch",
    AUTO_MODE: "bathroom_fan/auto_mode",
    HUMIDITY_MAX: "bathroom_fan/humidity_max",
    HUMIDITY_MIN: "bathroom_fan/humidity_min",
    DOOR_MODE: "bathroom_fan/door_mode",
    ON_DELAY: "bathroom_fan/on_delay_min",
    OFF_DELAY: "bathroom_fan/off_delay_min",
    HUMIDITY_SAFETY_MODE: "bathroom_fan/humidity_safety_mode",
    MANUAL_OFF_HUMIDITY_TIMEOUT: "bathroom_fan/manual_off_humidity_timeout_min"
};
var config = {
    ENTRY_CONFIRM_TIME_MS: 30000,
    SHORT_PRESS_MAX_MS: 1500,
    LONG_PRESS_MIN_MS: 3000,
    STARTUP_DELAY_MS: 2000,
    /*
     * Если обратная связь реле пришла позже этого времени,
     * она уже не считается подтверждением последней команды.
     *
     * Это используется только для диагностики и не влияет
     * на основную логику управления.
     */
    FAN_COMMAND_ACK_WINDOW_MS: 10000
};
defineVirtualDevice("bathroom_fan", {
    title: "Управление вытяжкой",
    cells: {
        fan_switch: {
            title: "Вентилятор",
            type: "switch",
            value: false
        },
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
        on_delay_min: {
            title: "Задержка автоматического включения, мин",
            type: "range",
            value: 0.17,
            min: 0,
            max: 10,
            precision: 2
        },
        off_delay_min: {
            title: "Задержка автоматического выключения, мин",
            type: "range",
            value: 5,
            min: 0,
            max: 60,
            precision: 2
        },
        humidity_safety_mode: {
            title: "Защита ручного отключения при высокой влажности",
            type: "switch",
            value: true
        },
        manual_off_humidity_timeout_min: {
            title: "Макс. ручное отключение при высокой влажности, мин",
            type: "range",
            value: 10,
            min: 0,
            max: 120,
            precision: 2
        }
    }
});
var state = {
    initialized: false,
    humidityDemand: false,
    presenceDemand: false,
    occupied: false,
    manualOverride: null,
    manualOverrideAutoCycle: false,
    fanSwitchSyncPending: null,
    lastMotionTime: 0,
    motionSeenSinceDoorOpened: false,
    buttonPressTime: 0,
    fanOnTimer: null,
    fanOffTimer: null,
    humiditySafetyTimer: null,
    /*
     * Используются для подавления повторяющихся сообщений.
     *
     * Если контрол отсутствует, ошибка записывается один раз.
     * После восстановления записывается отдельное INFO-сообщение.
     */
    unavailableControlsLogged: {},
    delayErrorsLogged: {},
    thresholdsErrorLogged: false,
    humidityValueErrorLogged: false,
    /*
     * Последняя команда физическому реле.
     *
     * Используется только для диагностики обратной связи:
     * позволяет отличить ожидаемое изменение реле от неожиданного.
     */
    lastFanCommandState: null,
    lastFanCommandTime: 0
};
/*
 * Преобразует дискретное значение к Boolean.
 */
function toBoolean(value) {
    if (value === true || value === 1) {
        return true;
    }
    if (typeof value === "string") {
        value = value.toLowerCase();
        return value === "1" || value === "true" || value === "on";
    }
    return false;
}
/*
 * Преобразует значение к Number.
 */
function toNumber(value) {
    if (value === undefined || value === null || value === "") {
        return NaN;
    }
    if (typeof value === "string") {
        value = value.replace(",", ".");
    }
    return Number(value);
}
/*
 * Проверяет доступность MQTT-контрола.
 *
 * Ошибка отсутствия одного контрола не записывается бесконечно:
 * первое обнаружение создаёт WARNING/ERROR, последующие проверки молчат.
 *
 * После восстановления контрола создаётся INFO.
 */
function checkControlAvailable(controlName, critical, context) {
    var value = dev[controlName];
    if (value === undefined || value === null) {
        if (!state.unavailableControlsLogged[controlName]) {
            if (critical) {
                log.error(
                    "bathroom_fan: control unavailable: '{}', context='{}'",
                    controlName,
                    context
                );
            } else {
                log.warning(
                    "bathroom_fan: control unavailable: '{}', context='{}'",
                    controlName,
                    context
                );
            }
            state.unavailableControlsLogged[controlName] = true;
        }
        return false;
    }
    if (state.unavailableControlsLogged[controlName]) {
        log.info(
            "bathroom_fan: control restored: '{}', value='{}'",
            controlName,
            value
        );
        state.unavailableControlsLogged[controlName] = false;
    }
    return true;
}
/*
 * Читает пользовательскую выдержку в минутах
 * и переводит её в миллисекунды.
 *
 * Некорректное значение считается нулевой задержкой,
 * но обязательно записывается в ERROR.
 */
function getDelayMilliseconds(controlName) {
    if (!checkControlAvailable(controlName, false, "reading delay")) {
        return 0;
    }
    var rawValue = dev[controlName];
    var minutes = toNumber(rawValue);
    if (isNaN(minutes) || minutes < 0) {
        if (!state.delayErrorsLogged[controlName]) {
            log.error(
                "bathroom_fan: invalid delay '{}': value='{}'. Zero delay will be used",
                controlName,
                rawValue
            );
            state.delayErrorsLogged[controlName] = true;
        }
        return 0;
    }
    if (state.delayErrorsLogged[controlName]) {
        log.info(
            "bathroom_fan: delay value restored: '{}', value={} min",
            controlName,
            minutes
        );
        state.delayErrorsLogged[controlName] = false;
    }
    return Math.round(minutes * 60 * 1000);
}
/*
 * Возвращает итоговое автоматическое требование.
 */
function getAutomaticDemand() {
    return state.humidityDemand || state.presenceDemand;
}
/*
 * Отменяет обычные автоматические таймеры.
 */
function clearAutomaticTimers() {
    if (state.fanOnTimer !== null) {
        clearTimeout(state.fanOnTimer);
        state.fanOnTimer = null;
        log.debug("bathroom_fan: automatic ON timer cancelled");
    }
    if (state.fanOffTimer !== null) {
        clearTimeout(state.fanOffTimer);
        state.fanOffTimer = null;
        log.debug("bathroom_fan: automatic OFF timer cancelled");
    }
}
/*
 * Отменяет все таймеры.
 */
function clearAllTimers() {
    clearAutomaticTimers();
    if (state.humiditySafetyTimer !== null) {
        clearTimeout(state.humiditySafetyTimer);
        state.humiditySafetyTimer = null;
        log.debug("bathroom_fan: humidity safety timer cancelled");
    }
}
/*
 * Единственная функция физической записи в реле вентилятора.
 *
 * Все ошибки непосредственной записи реле логируются здесь.
 */
function setFanState(newState, forceWrite) {
    newState = toBoolean(newState);
    if (!checkControlAvailable(topics.DO_FAN, true, "writing fan relay")) {
        log.error(
            "bathroom_fan: cannot set fan relay to {} because physical relay is unavailable",
            newState
        );
        return false;
    }
    var currentState = toBoolean(dev[topics.DO_FAN]);
    if (!forceWrite && currentState === newState) {
        log.debug(
            "bathroom_fan: relay write skipped, relay already {}",
            newState
        );
        return true;
    }
    try {
        /*
         * Запоминаем команду ДО записи.
         * При следующем feedback проверим, соответствует ли изменение
         * ожидаемому результату.
         */
        state.lastFanCommandState = newState;
        state.lastFanCommandTime = Date.now();
        dev[topics.DO_FAN] = newState;
        log.debug(
            "bathroom_fan: relay command sent: {} -> {}, forceWrite={}",
            currentState,
            newState,
            forceWrite
        );
        return true;
    } catch (error) {
        state.lastFanCommandState = null;
        state.lastFanCommandTime = 0;
        log.error(
            "bathroom_fan: failed to write physical relay '{}': {}",
            topics.DO_FAN,
            String(error)
        );
        return false;
    }
}
/*
 * Синхронизирует виртуальный переключатель
 * с фактическим состоянием реле.
 */
function syncVirtualFanSwitch() {
    if (!checkControlAvailable(topics.DO_FAN, true, "virtual switch synchronization")) {
        return;
    }
    if (!checkControlAvailable(controls.FAN_SWITCH, true, "virtual switch synchronization")) {
        return;
    }
    var actualFanState = toBoolean(dev[topics.DO_FAN]);
    var virtualFanState = toBoolean(dev[controls.FAN_SWITCH]);
    if (virtualFanState === actualFanState) {
        return;
    }
    state.fanSwitchSyncPending = actualFanState;
    try {
        dev[controls.FAN_SWITCH] = actualFanState;
        log.debug(
            "bathroom_fan: virtual fan switch synchronized: {} -> {}",
            virtualFanState,
            actualFanState
        );
    } catch (error) {
        state.fanSwitchSyncPending = null;
        log.error(
            "bathroom_fan: failed to synchronize virtual fan switch: {}",
            String(error)
        );
    }
}
/*
 * Проверяет корректность порогов влажности.
 */
function validateHumidityThresholds(humidityMin, humidityMax) {
    if (isNaN(humidityMin) || isNaN(humidityMax) || humidityMin >= humidityMax) {
        if (!state.thresholdsErrorLogged) {
            log.error(
                "bathroom_fan: invalid humidity thresholds: min={}, max={}",
                humidityMin,
                humidityMax
            );
            state.thresholdsErrorLogged = true;
        }
        return false;
    }
    if (state.thresholdsErrorLogged) {
        log.info(
            "bathroom_fan: humidity thresholds restored: min={}, max={}",
            humidityMin,
            humidityMax
        );
        state.thresholdsErrorLogged = false;
    }
    return true;
}
/*
 * Проверяет, находится ли влажность выше верхнего порога.
 */
function isHumidityAtOrAboveUpperThreshold() {
    if (!checkControlAvailable(topics.AI_HUMIDITY, false, "humidity safety check")) {
        return false;
    }
    if (!checkControlAvailable(controls.HUMIDITY_MAX, false, "humidity safety check")) {
        return false;
    }
    if (!checkControlAvailable(controls.HUMIDITY_MIN, false, "humidity safety check")) {
        return false;
    }
    var humidity = toNumber(dev[topics.AI_HUMIDITY]);
    var humidityMax = toNumber(dev[controls.HUMIDITY_MAX]);
    var humidityMin = toNumber(dev[controls.HUMIDITY_MIN]);
    if (!validateHumidityThresholds(humidityMin, humidityMax)) {
        return false;
    }
    if (isNaN(humidity)) {
        if (!state.humidityValueErrorLogged) {
            log.warning(
                "bathroom_fan: invalid humidity value: '{}'",
                dev[topics.AI_HUMIDITY]
            );
            state.humidityValueErrorLogged = true;
        }
        return false;
    }
    return humidity >= humidityMax;
}
/*
 * Синхронизирует защитный таймер ручного OFF.
 */
function syncHumiditySafetyTimer() {
    var timerRequired = toBoolean(dev[controls.AUTO_MODE]) &&
        toBoolean(dev[controls.HUMIDITY_SAFETY_MODE]) &&
        state.manualOverride === false &&
        isHumidityAtOrAboveUpperThreshold();
    if (!timerRequired) {
        if (state.humiditySafetyTimer !== null) {
            clearTimeout(state.humiditySafetyTimer);
            state.humiditySafetyTimer = null;
            log.debug(
                "bathroom_fan: humidity safety timer cancelled because required conditions disappeared"
            );
        }
        return;
    }
    if (state.humiditySafetyTimer !== null) {
        return;
    }
    var delayMilliseconds = getDelayMilliseconds(controls.MANUAL_OFF_HUMIDITY_TIMEOUT);
    if (delayMilliseconds === 0) {
        log.warning(
            "bathroom_fan: humidity safety timeout is zero; manual OFF override will be cancelled immediately"
        );
        state.manualOverride = null;
        state.manualOverrideAutoCycle = false;
        clearAutomaticTimers();
        setFanState(true, false);
        return;
    }
    log.debug(
        "bathroom_fan: humidity safety timer started: {} ms",
        delayMilliseconds
    );
    state.humiditySafetyTimer = setTimeout(function () {
        state.humiditySafetyTimer = null;
        var conditionsStillValid = toBoolean(dev[controls.AUTO_MODE]) &&
            toBoolean(dev[controls.HUMIDITY_SAFETY_MODE]) &&
            state.manualOverride === false &&
            isHumidityAtOrAboveUpperThreshold();
        if (!conditionsStillValid) {
            log.debug(
                "bathroom_fan: humidity safety timer expired but conditions are no longer valid"
            );
            return;
        }
        log.warning(
            "bathroom_fan: humidity safety timeout expired; manual OFF override cancelled and fan forced ON"
        );
        state.manualOverride = null;
        state.manualOverrideAutoCycle = false;
        clearAutomaticTimers();
        setFanState(true, false);
    }, delayMilliseconds);
}
/*
 * Запрашивает автоматическое включение.
 */
function requestAutomaticFanOn() {
    if (state.fanOffTimer !== null) {
        clearTimeout(state.fanOffTimer);
        state.fanOffTimer = null;
        log.debug(
            "bathroom_fan: OFF timer cancelled because automatic ON is required"
        );
    }
    if (state.manualOverride !== null || toBoolean(dev[topics.DO_FAN])) {
        if (state.fanOnTimer !== null) {
            clearTimeout(state.fanOnTimer);
            state.fanOnTimer = null;
        }
        return;
    }
    if (state.fanOnTimer !== null) {
        return;
    }
    var delayMilliseconds = getDelayMilliseconds(controls.ON_DELAY);
    if (delayMilliseconds === 0) {
        if (toBoolean(dev[controls.AUTO_MODE]) &&
            state.manualOverride === null &&
            getAutomaticDemand()) {
            setFanState(true, false);
        }
        return;
    }
    log.debug(
        "bathroom_fan: automatic ON timer started: {} ms",
        delayMilliseconds
    );
    state.fanOnTimer = setTimeout(function () {
        state.fanOnTimer = null;
        if (toBoolean(dev[controls.AUTO_MODE]) &&
            state.manualOverride === null &&
            getAutomaticDemand()) {
            setFanState(true, false);
            return;
        }
        log.debug(
            "bathroom_fan: automatic ON timer expired but ON conditions are no longer valid"
        );
    }, delayMilliseconds);
}
/*
 * Запрашивает автоматическое выключение.
 */
function requestAutomaticFanOff() {
    if (state.fanOnTimer !== null) {
        clearTimeout(state.fanOnTimer);
        state.fanOnTimer = null;
        log.debug(
            "bathroom_fan: ON timer cancelled because automatic OFF is required"
        );
    }
    if (state.manualOverride !== null || !toBoolean(dev[topics.DO_FAN])) {
        if (state.fanOffTimer !== null) {
            clearTimeout(state.fanOffTimer);
            state.fanOffTimer = null;
        }
        return;
    }
    if (state.fanOffTimer !== null) {
        return;
    }
    var delayMilliseconds = getDelayMilliseconds(controls.OFF_DELAY);
    if (delayMilliseconds === 0) {
        if (toBoolean(dev[controls.AUTO_MODE]) &&
            state.manualOverride === null &&
            !getAutomaticDemand()) {
            setFanState(false, false);
        }
        return;
    }
    log.debug(
        "bathroom_fan: automatic OFF timer started: {} ms",
        delayMilliseconds
    );
    state.fanOffTimer = setTimeout(function () {
        state.fanOffTimer = null;
        if (toBoolean(dev[controls.AUTO_MODE]) &&
            state.manualOverride === null &&
            !getAutomaticDemand()) {
            setFanState(false, false);
            return;
        }
        log.debug(
            "bathroom_fan: automatic OFF timer expired but OFF conditions are no longer valid"
        );
    }, delayMilliseconds);
}
/*
 * Центральная функция согласования управления.
 */
function reconcileFanControl() {
    if (!checkControlAvailable(controls.AUTO_MODE, true, "reconcile fan control")) {
        return;
    }
    if (!toBoolean(dev[controls.AUTO_MODE])) {
        clearAllTimers();
        if (state.manualOverride !== null) {
            setFanState(state.manualOverride, false);
        }
        return;
    }
    if (state.manualOverride !== null) {
        clearAutomaticTimers();
        setFanState(state.manualOverride, false);
        syncHumiditySafetyTimer();
        return;
    }
    if (state.humiditySafetyTimer !== null) {
        clearTimeout(state.humiditySafetyTimer);
        state.humiditySafetyTimer = null;
        log.debug(
            "bathroom_fan: humidity safety timer cancelled because manual override is no longer active"
        );
    }
    if (getAutomaticDemand()) {
        requestAutomaticFanOn();
    } else {
        requestAutomaticFanOff();
    }
}
/*
 * Обрабатывает изменение общего автоматического требования.
 */
function handleAutomaticDemandChange(previousAutomaticDemand) {
    var currentAutomaticDemand = getAutomaticDemand();
    if (state.manualOverride !== null &&
        state.manualOverrideAutoCycle &&
        !currentAutomaticDemand) {
        log.debug(
            "bathroom_fan: automatic cycle finished; temporary manual override removed"
        );
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
    if (previousAutomaticDemand !== currentAutomaticDemand) {
        log.debug(
            "bathroom_fan: automatic demand changed: {} -> {}, humidityDemand={}, presenceDemand={}",
            previousAutomaticDemand,
            currentAutomaticDemand,
            state.humidityDemand,
            state.presenceDemand
        );
        reconcileFanControl();
    }
}
/*
 * Пересчитывает требование по влажности.
 */
function refreshHumidityDemand() {
    if (!checkControlAvailable(topics.AI_HUMIDITY, false, "humidity processing")) {
        return false;
    }
    if (!checkControlAvailable(controls.HUMIDITY_MAX, false, "humidity processing")) {
        return false;
    }
    if (!checkControlAvailable(controls.HUMIDITY_MIN, false, "humidity processing")) {
        return false;
    }
    var humidity = toNumber(dev[topics.AI_HUMIDITY]);
    var humidityMax = toNumber(dev[controls.HUMIDITY_MAX]);
    var humidityMin = toNumber(dev[controls.HUMIDITY_MIN]);
    if (!validateHumidityThresholds(humidityMin, humidityMax)) {
        return false;
    }
    if (isNaN(humidity)) {
        if (!state.humidityValueErrorLogged) {
            log.warning(
                "bathroom_fan: humidity sensor returned invalid value: '{}'. Previous humidity demand will be preserved",
                dev[topics.AI_HUMIDITY]
            );
            state.humidityValueErrorLogged = true;
        }
        return false;
    }
    if (state.humidityValueErrorLogged) {
        log.info(
            "bathroom_fan: valid humidity data restored: {}%",
            humidity
        );
        state.humidityValueErrorLogged = false;
    }
    var previousHumidityDemand = state.humidityDemand;
    if (humidity >= humidityMax) {
        state.humidityDemand = true;
    } else if (humidity <= humidityMin) {
        state.humidityDemand = false;
    }
    return previousHumidityDemand !== state.humidityDemand;
}
/*
 * Обрабатывает изменение влажности.
 */
function processHumidityChange() {
    var previousAutomaticDemand = getAutomaticDemand();
    var demandChanged = refreshHumidityDemand();
    if (!demandChanged) {
        syncHumiditySafetyTimer();
        return;
    }
    log.debug(
        "bathroom_fan: humidity demand changed: {}, humidity='{}'",
        state.humidityDemand,
        dev[topics.AI_HUMIDITY]
    );
    handleAutomaticDemandChange(previousAutomaticDemand);
}
/*
 * Устанавливает подтверждённое присутствие.
 */
function setOccupied(newState) {
    var previousAutomaticDemand = getAutomaticDemand();
    state.occupied = toBoolean(newState);
    if (!checkControlAvailable(controls.DOOR_MODE, false, "presence calculation") ||
        !checkControlAvailable(topics.DI_DOOR_CLOSED, false, "presence calculation")) {
        state.presenceDemand = false;
        log.warning(
            "bathroom_fan: presence demand forced to false because required controls are unavailable"
        );
    } else {
        state.presenceDemand = toBoolean(dev[controls.DOOR_MODE]) &&
            toBoolean(dev[topics.DI_DOOR_CLOSED]) &&
            state.occupied;
    }
    handleAutomaticDemandChange(previousAutomaticDemand);
}
/*
 * Общая функция ручного управления.
 */
function applyManualFanState(targetFanState) {
    targetFanState = toBoolean(targetFanState);
    var automaticDemand = getAutomaticDemand();
    clearAllTimers();
    log.info(
        "bathroom_fan: manual fan command: {}, automaticDemand={}, autoMode={}",
        targetFanState,
        automaticDemand,
        toBoolean(dev[controls.AUTO_MODE])
    );
    if (!checkControlAvailable(controls.AUTO_MODE, true, "manual fan command")) {
        log.error(
            "bathroom_fan: manual command cannot be processed because AUTO_MODE control is unavailable"
        );
        return;
    }
    if (!toBoolean(dev[controls.AUTO_MODE])) {
        state.manualOverride = targetFanState;
        state.manualOverrideAutoCycle = false;
        setFanState(targetFanState, true);
        return;
    }
    if (!targetFanState && !automaticDemand) {
        state.manualOverride = null;
        state.manualOverrideAutoCycle = false;
        setFanState(false, true);
        return;
    }
    state.manualOverride = targetFanState;
    state.manualOverrideAutoCycle = automaticDemand;
    setFanState(targetFanState, true);
    syncHumiditySafetyTimer();
}
/*
 * Короткое физическое нажатие.
 */
function applyManualButtonAction() {
    if (!checkControlAvailable(topics.DO_FAN, true, "physical button action")) {
        log.error(
            "bathroom_fan: short button press ignored because fan relay state is unknown"
        );
        return;
    }
    applyManualFanState(!toBoolean(dev[topics.DO_FAN]));
}
/*
 * Изменение автоматического режима.
 */
function handleAutoModeChange(enabled) {
    clearAllTimers();
    enabled = toBoolean(enabled);
    log.info(
        "bathroom_fan: automatic mode changed: {}",
        enabled
    );
    if (!enabled) {
        if (!checkControlAvailable(topics.DO_FAN, true, "disabling automatic mode")) {
            state.manualOverride = null;
            state.manualOverrideAutoCycle = false;
            log.warning(
                "bathroom_fan: automatic mode disabled while relay state is unknown; manual override cannot be initialized"
            );
            return;
        }
        state.manualOverride = toBoolean(dev[topics.DO_FAN]);
        state.manualOverrideAutoCycle = false;
        return;
    }
    state.manualOverride = null;
    state.manualOverrideAutoCycle = false;
    refreshHumidityDemand();
    if (!checkControlAvailable(controls.DOOR_MODE, false, "enabling automatic mode") ||
        !checkControlAvailable(topics.DI_DOOR_CLOSED, false, "enabling automatic mode")) {
        state.presenceDemand = false;
    } else {
        state.presenceDemand = toBoolean(dev[controls.DOOR_MODE]) &&
            toBoolean(dev[topics.DI_DOOR_CLOSED]) &&
            state.occupied;
    }
    reconcileFanControl();
}
/*
 * Виртуальный переключатель вентилятора.
 */
defineRule("bathroom_fan_virtual_switch", {
    whenChanged: controls.FAN_SWITCH,
    then: function (newValue) {
        if (!state.initialized) {
            log.debug(
                "bathroom_fan: virtual fan switch event ignored during initialization"
            );
            return;
        }
        var requestedState = toBoolean(newValue);
        if (state.fanSwitchSyncPending !== null &&
            requestedState === state.fanSwitchSyncPending) {
            state.fanSwitchSyncPending = null;
            log.debug(
                "bathroom_fan: virtual switch service synchronization confirmed: {}",
                requestedState
            );
            return;
        }
        /*
         * Если существовало ожидаемое служебное значение,
         * но пришло другое, произошла гонка или пользователь
         * изменил переключатель во время синхронизации.
         */
        if (state.fanSwitchSyncPending !== null &&
            requestedState !== state.fanSwitchSyncPending) {
            log.warning(
                "bathroom_fan: unexpected virtual switch value during synchronization: expected={}, received={}",
                state.fanSwitchSyncPending,
                requestedState
            );
        }
        state.fanSwitchSyncPending = null;
        applyManualFanState(requestedState);
    }
});
/*
 * Изменение влажности.
 */
defineRule("bathroom_fan_humidity", {
    whenChanged: topics.AI_HUMIDITY,
    then: function () {
        if (!state.initialized) {
            return;
        }
        processHumidityChange();
    }
});
/*
 * Изменение порогов влажности.
 */
defineRule("bathroom_fan_humidity_settings", {
    whenChanged: [
        controls.HUMIDITY_MAX,
        controls.HUMIDITY_MIN
    ],
    then: function () {
        if (!state.initialized) {
            return;
        }
        log.debug(
            "bathroom_fan: humidity thresholds changed: min='{}', max='{}'",
            dev[controls.HUMIDITY_MIN],
            dev[controls.HUMIDITY_MAX]
        );
        processHumidityChange();
    }
});
/*
 * Включение/отключение защиты ручного OFF.
 */
defineRule("bathroom_fan_humidity_safety_mode", {
    whenChanged: controls.HUMIDITY_SAFETY_MODE,
    then: function (newValue) {
        if (!state.initialized) {
            return;
        }
        log.info(
            "bathroom_fan: humidity manual-OFF protection changed: {}",
            toBoolean(newValue)
        );
        syncHumiditySafetyTimer();
    }
});
/*
 * Изменение времени защиты ручного OFF.
 */
defineRule("bathroom_fan_humidity_safety_timeout", {
    whenChanged: controls.MANUAL_OFF_HUMIDITY_TIMEOUT,
    then: function (newValue) {
        if (!state.initialized) {
            return;
        }
        log.info(
            "bathroom_fan: humidity safety timeout changed: {} min",
            newValue
        );
        if (state.humiditySafetyTimer !== null) {
            clearTimeout(state.humiditySafetyTimer);
            state.humiditySafetyTimer = null;
            log.debug(
                "bathroom_fan: existing humidity safety timer cancelled because timeout setting changed"
            );
        }
        syncHumiditySafetyTimer();
    }
});
/*
 * Датчик движения.
 */
defineRule("bathroom_fan_motion", {
    whenChanged: topics.DI_MOTION,
    then: function (newValue) {
        if (!state.initialized) {
            return;
        }
        if (!toBoolean(newValue)) {
            return;
        }
        state.lastMotionTime = Date.now();
        if (!checkControlAvailable(controls.DOOR_MODE, false, "motion processing")) {
            return;
        }
        if (!toBoolean(dev[controls.DOOR_MODE])) {
            return;
        }
        if (!checkControlAvailable(topics.DI_DOOR_CLOSED, false, "motion processing")) {
            log.warning(
                "bathroom_fan: motion detected but door state is unavailable; presence cannot be confirmed"
            );
            return;
        }
        if (!toBoolean(dev[topics.DI_DOOR_CLOSED])) {
            state.motionSeenSinceDoorOpened = true;
            return;
        }
        setOccupied(true);
    }
});
/*
 * Концевик двери.
 */
defineRule("bathroom_fan_door", {
    whenChanged: topics.DI_DOOR_CLOSED,
    then: function (newValue) {
        if (!state.initialized) {
            return;
        }
        var doorClosed = toBoolean(newValue);
        if (!doorClosed) {
            state.motionSeenSinceDoorOpened = false;
            setOccupied(false);
            return;
        }
        if (!checkControlAvailable(controls.DOOR_MODE, false, "door processing")) {
            setOccupied(false);
            return;
        }
        if (!toBoolean(dev[controls.DOOR_MODE])) {
            setOccupied(false);
            return;
        }
        var entryConfirmed = state.motionSeenSinceDoorOpened &&
            state.lastMotionTime > 0 &&
            Date.now() - state.lastMotionTime <= config.ENTRY_CONFIRM_TIME_MS;
        state.motionSeenSinceDoorOpened = false;
        setOccupied(entryConfirmed);
    }
});
/*
 * Включение/отключение управления по двери и движению.
 */
defineRule("bathroom_fan_door_mode", {
    whenChanged: controls.DOOR_MODE,
    then: function (newValue) {
        if (!state.initialized) {
            return;
        }
        log.info(
            "bathroom_fan: door/motion control changed: {}",
            toBoolean(newValue)
        );
        if (!toBoolean(newValue)) {
            setOccupied(false);
            return;
        }
        if (!checkControlAvailable(topics.DI_DOOR_CLOSED, false, "enabling door mode") ||
            !checkControlAvailable(topics.DI_MOTION, false, "enabling door mode")) {
            log.warning(
                "bathroom_fan: door/motion control enabled but required sensors are unavailable"
            );
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
 * Изменение автоматических задержек.
 */
defineRule("bathroom_fan_delays", {
    whenChanged: [
        controls.ON_DELAY,
        controls.OFF_DELAY
    ],
    then: function () {
        if (!state.initialized) {
            return;
        }
        log.info(
            "bathroom_fan: automatic delays changed: ON={} min, OFF={} min",
            dev[controls.ON_DELAY],
            dev[controls.OFF_DELAY]
        );
        clearAutomaticTimers();
        reconcileFanControl();
    }
});
/*
 * Переключение автоматического режима.
 */
defineRule("bathroom_fan_auto_mode", {
    whenChanged: controls.AUTO_MODE,
    then: function (newValue) {
        if (!state.initialized) {
            return;
        }
        handleAutoModeChange(newValue);
    }
});
/*
 * Физический настенный выключатель.
 *
 * <= 1,5 с — короткое нажатие.
 * >= 3 с   — длинное нажатие.
 * 1,5...3 с — намеренно игнорируется.
 */
defineRule("bathroom_fan_button", {
    whenChanged: topics.DI_WALL_SWITCH,
    then: function (newValue) {
        if (!state.initialized) {
            return;
        }
        if (toBoolean(newValue)) {
            /*
             * Повторное событие ON при уже зарегистрированном
             * нажатии выглядит подозрительно.
             */
            if (state.buttonPressTime !== 0) {
                log.warning(
                    "bathroom_fan: duplicate wall button press event detected"
                );
            }
            state.buttonPressTime = Date.now();
            return;
        }
        /*
         * Пришло отпускание, хотя начала нажатия не было.
         *
         * Возможные причины:
         * - потерянное MQTT-событие;
         * - перезапуск скрипта во время удержания;
         * - помеха на входе;
         * - дребезг.
         */
        if (state.buttonPressTime === 0) {
            log.warning(
                "bathroom_fan: wall button release received without registered press"
            );
            return;
        }
        var pressDuration = Date.now() - state.buttonPressTime;
        state.buttonPressTime = 0;
        if (pressDuration < 0) {
            log.error(
                "bathroom_fan: invalid wall button press duration: {} ms",
                pressDuration
            );
            return;
        }
        if (pressDuration <= config.SHORT_PRESS_MAX_MS) {
            log.debug(
                "bathroom_fan: short wall button press: {} ms",
                pressDuration
            );
            applyManualButtonAction();
            return;
        }
        if (pressDuration >= config.LONG_PRESS_MIN_MS) {
            log.info(
                "bathroom_fan: long wall button press: {} ms; toggling automatic mode",
                pressDuration
            );
            if (!checkControlAvailable(controls.AUTO_MODE, true, "long button press")) {
                return;
            }
            dev[controls.AUTO_MODE] = !toBoolean(dev[controls.AUTO_MODE]);
            return;
        }
        log.debug(
            "bathroom_fan: wall button press ignored because duration is between short and long thresholds: {} ms",
            pressDuration
        );
    }
});
/*
 * Обратная связь физического реле.
 *
 * Здесь также проверяется, было ли изменение ожидаемым
 * результатом нашей последней команды.
 */
defineRule("bathroom_fan_relay_feedback", {
    whenChanged: topics.DO_FAN,
    then: function (newValue) {
        if (!state.initialized) {
            return;
        }
        var actualFanState = toBoolean(newValue);
        var commandAge = Date.now() - state.lastFanCommandTime;
        /*
         * Если недавно была отправлена команда и состояние совпало,
         * считаем feedback подтверждением команды.
         */
        if (state.lastFanCommandState !== null &&
            actualFanState === state.lastFanCommandState &&
            commandAge >= 0 &&
            commandAge <= config.FAN_COMMAND_ACK_WINDOW_MS) {
            log.debug(
                "bathroom_fan: relay command confirmed: state={}, responseTime={} ms",
                actualFanState,
                commandAge
            );
            state.lastFanCommandState = null;
            state.lastFanCommandTime = 0;
        } else {
            /*
             * Если состояние изменилось без ожидаемой команды
             * или не совпало с последней командой, это может быть:
             *
             * - другой скрипт;
             * - ручное изменение MQTT;
             * - запоздавший ответ устройства;
             * - потеря/перестановка сообщений;
             * - внешнее управление реле.
             */
            if (state.lastFanCommandState !== null) {
                log.warning(
                    "bathroom_fan: unexpected relay feedback: actual={}, expected={}, commandAge={} ms",
                    actualFanState,
                    state.lastFanCommandState,
                    commandAge
                );
            } else {
                log.warning(
                    "bathroom_fan: physical relay changed without pending command: newState={}",
                    actualFanState
                );
            }
            state.lastFanCommandState = null;
            state.lastFanCommandTime = 0;
        }
        syncVirtualFanSwitch();
        /*
         * В ручном режиме первое известное состояние
         * принимаем как исходное, если оно ещё не было определено.
         */
        if (!toBoolean(dev[controls.AUTO_MODE]) &&
            state.manualOverride === null) {
            log.info(
                "bathroom_fan: initial manual relay state received: {}",
                actualFanState
            );
            state.manualOverride = actualFanState;
            state.manualOverrideAutoCycle = false;
            return;
        }
        /*
         * После любого изменения физического реле
         * ещё раз применяем текущее решение контроллера.
         */
        reconcileFanControl();
    }
});
/*
 * Первоначальная инициализация.
 */
function initializeController() {
    log.info("bathroom_fan: controller initialization started");
    clearAllTimers();
    /*
     * Проверяем физический выход.
     */
    checkControlAvailable(
        topics.DO_FAN,
        true,
        "startup"
    );
    /*
     * Проверяем основные настройки.
     */
    checkControlAvailable(
        controls.AUTO_MODE,
        true,
        "startup"
    );
    checkControlAvailable(
        controls.DOOR_MODE,
        false,
        "startup"
    );
    checkControlAvailable(
        controls.HUMIDITY_SAFETY_MODE,
        false,
        "startup"
    );
    /*
     * Восстанавливаем требование по влажности.
     */
    refreshHumidityDemand();
    /*
     * Проверяем движение.
     */
    if (checkControlAvailable(topics.DI_MOTION, false, "startup")) {
        if (toBoolean(dev[topics.DI_MOTION])) {
            state.lastMotionTime = Date.now();
        }
    }
    /*
     * Определяем присутствие.
     */
    if (checkControlAvailable(controls.DOOR_MODE, false, "startup") &&
        checkControlAvailable(topics.DI_DOOR_CLOSED, false, "startup") &&
        checkControlAvailable(topics.DI_MOTION, false, "startup")) {
        state.occupied = toBoolean(dev[controls.DOOR_MODE]) &&
            toBoolean(dev[topics.DI_DOOR_CLOSED]) &&
            toBoolean(dev[topics.DI_MOTION]);
    } else {
        state.occupied = false;
        log.warning(
            "bathroom_fan: presence cannot be reliably initialized because one or more sensors are unavailable"
        );
    }
    state.presenceDemand = state.occupied;
    state.motionSeenSinceDoorOpened = false;
    state.buttonPressTime = 0;
    state.fanSwitchSyncPending = null;
    state.lastFanCommandState = null;
    state.lastFanCommandTime = 0;
    /*
     * Инициализация ручного состояния.
     */
    if (checkControlAvailable(controls.AUTO_MODE, true, "startup")) {
        if (toBoolean(dev[controls.AUTO_MODE])) {
            state.manualOverride = null;
            state.manualOverrideAutoCycle = false;
        } else {
            if (checkControlAvailable(topics.DO_FAN, true, "startup manual mode")) {
                state.manualOverride = toBoolean(dev[topics.DO_FAN]);
            } else {
                state.manualOverride = null;
                log.warning(
                    "bathroom_fan: startup in manual mode but physical relay state is unknown"
                );
            }
            state.manualOverrideAutoCycle = false;
        }
    } else {
        state.manualOverride = null;
        state.manualOverrideAutoCycle = false;
        log.error(
            "bathroom_fan: AUTO_MODE unavailable during initialization; safe control decision cannot be made"
        );
    }
    /*
     * Разрешаем рабочие события только после заполнения state.
     */
    state.initialized = true;
    /*
     * Виртуальный переключатель всегда приводим
     * к фактическому состоянию реле.
     */
    syncVirtualFanSwitch();
    /*
     * Если автоматический режим доступен и включён,
     * передаём управление основной логике.
     */
    if (checkControlAvailable(controls.AUTO_MODE, true, "startup finalization") &&
        toBoolean(dev[controls.AUTO_MODE])) {
        reconcileFanControl();
    }
    log.info(
        "bathroom_fan: initialization completed: autoMode={}, fan={}, humidityDemand={}, presenceDemand={}, manualOverride={}",
        dev[controls.AUTO_MODE],
        dev[topics.DO_FAN],
        state.humidityDemand,
        state.presenceDemand,
        state.manualOverride
    );
}
/*
 * Даём физическим MQTT-контролам время получить retained/актуальные значения.
 *
 * Если спустя две секунды какие-либо необходимые контролы ещё не появились,
 * initializeController() запишет это в журнал.
 */
setTimeout(initializeController, config.STARTUP_DELAY_MS);