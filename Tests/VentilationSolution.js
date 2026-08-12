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
 * 14. Все сообщения журнала имеют формат:
 *
 *     <tsdk> VENTILATION: <устройство/контрол>. <сообщение>
 *
 * 15. При подтверждённом изменении физического реле записывается
 *     причина включения или выключения.
 */
var TM_PREFIX = "<tsdk> ";
var LOG_PREFIX = "VENTILATION: ";
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
     * Максимальное время ожидания подтверждения команды реле.
     * Используется только для диагностики.
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
    manualOverrideReason: null,
    fanSwitchSyncPending: null,
    lastMotionTime: 0,
    motionSeenSinceDoorOpened: false,
    buttonPressTime: 0,
    fanOnTimer: null,
    fanOffTimer: null,
    humiditySafetyTimer: null,
    /*
     * Таймер диагностики подтверждения физической команды реле.
     */
    fanAckTimer: null,
    unavailableControlsLogged: {},
    delayErrorsLogged: {},
    thresholdsErrorLogged: false,
    humidityValueErrorLogged: false,
    /*
     * Последняя команда физическому реле.
     *
     * Сохраняются:
     * - требуемое состояние;
     * - причина;
     * - время отправки.
     */
    lastFanCommandState: null,
    lastFanCommandReason: null,
    lastFanCommandTime: 0,
    /*
     * Если физическое состояние реле ещё не было известно
     * на момент инициализации.
     */
    awaitingInitialRelayState: false
};
/*
 * Формирует общий заголовок сообщения журнала.
 *
 * Пример:
 *
 * <tsdk> VENTILATION: wb-mr6c_209/K5.
 */
function getLogPrefix(deviceName) {
    return TM_PREFIX + LOG_PREFIX + String(deviceName) + ". ";
}
/*
 * Служебные функции логирования.
 *
 * Они гарантируют одинаковый формат всех сообщений.
 */
function logDebug(deviceName, message) {
    log.debug(getLogPrefix(deviceName) + message);
}
function logInfo(deviceName, message) {
    log.info(getLogPrefix(deviceName) + message);
}
function logWarning(deviceName, message) {
    log.warning(getLogPrefix(deviceName) + message);
}
function logError(deviceName, message) {
    log.error(getLogPrefix(deviceName) + message);
}
/*
 * Преобразует состояние в текст ON/OFF.
 */
function stateToText(value) {
    return toBoolean(value) ? "ON" : "OFF";
}
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
 * Возвращает причину текущего автоматического включения.
 *
 * Причина определяется непосредственно перед фактической командой,
 * поэтому учитывается актуальное состояние всех автоматических требований.
 */
function getAutomaticOnReason() {
    if (state.humidityDemand && state.presenceDemand) {
        return "автоматически по высокой влажности и подтверждённому присутствию.";
    }
    if (state.humidityDemand) {
        return "автоматически по достижению верхнего порога влажности.";
    }
    if (state.presenceDemand) {
        return "автоматически по подтверждённому присутствию.";
    }
    return "автоматически по текущему требованию автоматики.";
}
/*
 * Возвращает причину автоматического выключения.
 */
function getAutomaticOffReason() {
    return "автоматически после исчезновения всех автоматических причин.";
}
/*
 * Проверяет доступность контрола.
 *
 * Ошибка отсутствия каждого контрола логируется только один раз.
 * После восстановления записывается INFO.
 */
function checkControlAvailable(controlName, critical, context) {
    var value;
    try {
        value = dev[controlName];
    } catch (error) {
        if (!state.unavailableControlsLogged[controlName]) {
            logError(
                controlName,
                "Ошибка чтения контрола. Контекст: " + context +
                ". Ошибка: " + String(error)
            );
            state.unavailableControlsLogged[controlName] = true;
        }
        return false;
    }
    if (value === undefined || value === null) {
        if (!state.unavailableControlsLogged[controlName]) {
            if (critical) {
                logError(
                    controlName,
                    "Контрол недоступен. Контекст: " + context + "."
                );
            } else {
                logWarning(
                    controlName,
                    "Контрол недоступен. Контекст: " + context + "."
                );
            }
            state.unavailableControlsLogged[controlName] = true;
        }
        return false;
    }
    if (state.unavailableControlsLogged[controlName]) {
        logInfo(
            controlName,
            "Контрол восстановлен. Текущее значение: '" + String(value) + "'."
        );
        state.unavailableControlsLogged[controlName] = false;
    }
    return true;
}
/*
 * Читает пользовательскую выдержку в минутах
 * и переводит её в миллисекунды.
 */
function getDelayMilliseconds(controlName) {
    if (!checkControlAvailable(controlName, false, "чтение выдержки времени")) {
        return 0;
    }
    var rawValue = dev[controlName];
    var minutes = toNumber(rawValue);
    if (isNaN(minutes) || minutes < 0) {
        if (!state.delayErrorsLogged[controlName]) {
            logError(
                controlName,
                "Некорректная выдержка времени: '" + String(rawValue) +
                "'. Будет использовано значение 0 мин."
            );
            state.delayErrorsLogged[controlName] = true;
        }
        return 0;
    }
    if (state.delayErrorsLogged[controlName]) {
        logInfo(
            controlName,
            "Корректное значение выдержки восстановлено: " +
            String(minutes) + " мин."
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
        logDebug(
            topics.DO_FAN,
            "Таймер автоматического включения отменён."
        );
    }
    if (state.fanOffTimer !== null) {
        clearTimeout(state.fanOffTimer);
        state.fanOffTimer = null;
        logDebug(
            topics.DO_FAN,
            "Таймер автоматического выключения отменён."
        );
    }
}
/*
 * Отменяет все управляющие таймеры.
 */
function clearAllTimers() {
    clearAutomaticTimers();
    if (state.humiditySafetyTimer !== null) {
        clearTimeout(state.humiditySafetyTimer);
        state.humiditySafetyTimer = null;
        logDebug(
            topics.DO_FAN,
            "Защитный таймер ручного отключения при высокой влажности отменён."
        );
    }
}
/*
 * Очищает ожидание подтверждения команды физического реле.
 */
function clearFanCommandTracking() {
    if (state.fanAckTimer !== null) {
        clearTimeout(state.fanAckTimer);
        state.fanAckTimer = null;
    }
    state.lastFanCommandState = null;
    state.lastFanCommandReason = null;
    state.lastFanCommandTime = 0;
}
/*
 * Единственная функция физической записи в реле вентилятора.
 *
 * reason содержит причину команды без слова "Включено" или "Выключено".
 *
 * Пример:
 *
 * reason =
 * "автоматически по достижению верхнего порога влажности."
 *
 * После подтверждения реле журнал сформирует:
 *
 * <tsdk> VENTILATION: wb-mr6c_209/K5.
 * Включено автоматически по достижению верхнего порога влажности.
 */
function setFanState(newState, forceWrite, reason) {
    newState = toBoolean(newState);
    if (!reason) {
        reason = "по причине, не указанной вызывающей функцией.";
    }
    if (!checkControlAvailable(topics.DO_FAN, true, "управление физическим реле")) {
        logError(
            topics.DO_FAN,
            "Невозможно отправить команду " + stateToText(newState) +
            ". Физический выход недоступен."
        );
        return false;
    }
    var currentState = toBoolean(dev[topics.DO_FAN]);
    /*
     * Новая команда заменяет предыдущую неподтверждённую команду.
     */
    if (state.lastFanCommandState !== null) {
        logDebug(
            topics.DO_FAN,
            "Предыдущая неподтверждённая команда " +
            stateToText(state.lastFanCommandState) +
            " заменена новой командой " + stateToText(newState) + "."
        );
        clearFanCommandTracking();
    }
    /*
     * В обычной автоматике повторная запись того же состояния не требуется.
     */
    if (!forceWrite && currentState === newState) {
        logDebug(
            topics.DO_FAN,
            "Команда " + stateToText(newState) +
            " не отправлена: физическое реле уже находится в требуемом состоянии."
        );
        return true;
    }
    try {
        /*
         * Если состояние должно реально измениться,
         * ожидаем whenChanged от физического реле.
         */
        var expectStateChange = currentState !== newState;
        var commandTime = Date.now();
        if (expectStateChange) {
            state.lastFanCommandState = newState;
            state.lastFanCommandReason = reason;
            state.lastFanCommandTime = commandTime;
        }
        dev[topics.DO_FAN] = newState;
        logDebug(
            topics.DO_FAN,
            "Отправлена команда " + stateToText(newState) +
            ". Причина: " + reason
        );
        /*
         * Если состояние действительно должно измениться,
         * запускаем диагностический контроль подтверждения.
         */
        if (expectStateChange) {
            state.fanAckTimer = setTimeout(function () {
                if (state.lastFanCommandState === newState &&
                    state.lastFanCommandTime === commandTime) {
                    logError(
                        topics.DO_FAN,
                        "Не получено подтверждение команды " +
                        stateToText(newState) + " в течение " +
                        String(config.FAN_COMMAND_ACK_WINDOW_MS / 1000) +
                        " с. Причина команды: " + reason
                    );
                    clearFanCommandTracking();
                }
            }, config.FAN_COMMAND_ACK_WINDOW_MS);
        } else {
            /*
             * forceWrite=true может отправлять повторную команду тому же
             * состоянию. В таком случае whenChanged может не возникнуть,
             * поэтому подтверждение состояния не ожидается.
             */
            logDebug(
                topics.DO_FAN,
                "Повторная команда отправлена без ожидания whenChanged, " +
                "так как состояние реле уже равно " + stateToText(newState) + "."
            );
        }
        return true;
    } catch (error) {
        clearFanCommandTracking();
        logError(
            topics.DO_FAN,
            "Ошибка записи физического реле: " + String(error)
        );
        return false;
    }
}
/*
 * Синхронизирует виртуальный переключатель
 * с фактическим состоянием физического реле.
 */
function syncVirtualFanSwitch() {
    if (!checkControlAvailable(
        topics.DO_FAN,
        true,
        "синхронизация виртуального переключателя"
    )) {
        return;
    }
    if (!checkControlAvailable(
        controls.FAN_SWITCH,
        true,
        "синхронизация виртуального переключателя"
    )) {
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
        logDebug(
            controls.FAN_SWITCH,
            "Синхронизирован с физическим реле " + topics.DO_FAN +
            ": " + stateToText(virtualFanState) +
            " -> " + stateToText(actualFanState) + "."
        );
    } catch (error) {
        state.fanSwitchSyncPending = null;
        logError(
            controls.FAN_SWITCH,
            "Ошибка синхронизации с физическим реле: " + String(error)
        );
    }
}
/*
 * Проверяет корректность порогов влажности.
 */
function validateHumidityThresholds(humidityMin, humidityMax) {
    if (isNaN(humidityMin) || isNaN(humidityMax) || humidityMin >= humidityMax) {
        if (!state.thresholdsErrorLogged) {
            logError(
                controls.HUMIDITY_MAX,
                "Некорректные пороги влажности: min=" +
                String(humidityMin) + ", max=" + String(humidityMax) + "."
            );
            state.thresholdsErrorLogged = true;
        }
        return false;
    }
    if (state.thresholdsErrorLogged) {
        logInfo(
            controls.HUMIDITY_MAX,
            "Корректные пороги влажности восстановлены: min=" +
            String(humidityMin) + ", max=" + String(humidityMax) + "."
        );
        state.thresholdsErrorLogged = false;
    }
    return true;
}
/*
 * Проверяет, находится ли влажность не ниже верхнего порога.
 */
function isHumidityAtOrAboveUpperThreshold() {
    if (!checkControlAvailable(
        topics.AI_HUMIDITY,
        false,
        "проверка защиты по влажности"
    )) {
        return false;
    }
    if (!checkControlAvailable(
        controls.HUMIDITY_MAX,
        false,
        "проверка защиты по влажности"
    )) {
        return false;
    }
    if (!checkControlAvailable(
        controls.HUMIDITY_MIN,
        false,
        "проверка защиты по влажности"
    )) {
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
            logWarning(
                topics.AI_HUMIDITY,
                "Получено некорректное значение влажности: '" +
                String(dev[topics.AI_HUMIDITY]) + "'."
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
            logDebug(
                topics.DO_FAN,
                "Защитный таймер ручного отключения отменён, " +
                "так как необходимые условия больше не выполняются."
            );
        }
        return;
    }
    if (state.humiditySafetyTimer !== null) {
        return;
    }
    var delayMilliseconds = getDelayMilliseconds(
        controls.MANUAL_OFF_HUMIDITY_TIMEOUT
    );
    if (delayMilliseconds === 0) {
        logWarning(
            controls.MANUAL_OFF_HUMIDITY_TIMEOUT,
            "Время защиты равно 0 мин. Ручное отключение при высокой " +
            "влажности будет снято немедленно."
        );
        state.manualOverride = null;
        state.manualOverrideAutoCycle = false;
        state.manualOverrideReason = null;
        clearAutomaticTimers();
        setFanState(
            true,
            false,
            "защитой, так как максимальное время ручного отключения " +
            "при высокой влажности задано 0 мин."
        );
        return;
    }
    logDebug(
        topics.DO_FAN,
        "Запущен защитный таймер ручного отключения на " +
        String(delayMilliseconds / 60000) + " мин."
    );
    state.humiditySafetyTimer = setTimeout(function () {
        state.humiditySafetyTimer = null;
        var conditionsStillValid = toBoolean(dev[controls.AUTO_MODE]) &&
            toBoolean(dev[controls.HUMIDITY_SAFETY_MODE]) &&
            state.manualOverride === false &&
            isHumidityAtOrAboveUpperThreshold();
        if (!conditionsStillValid) {
            logDebug(
                topics.DO_FAN,
                "Защитный таймер завершён, но условия защитного " +
                "включения больше не выполняются."
            );
            return;
        }
        state.manualOverride = null;
        state.manualOverrideAutoCycle = false;
        state.manualOverrideReason = null;
        clearAutomaticTimers();
        setFanState(
            true,
            false,
            "защитой после истечения максимального времени ручного " +
            "отключения при высокой влажности."
        );
    }, delayMilliseconds);
}
/*
 * Запрашивает автоматическое включение.
 */
function requestAutomaticFanOn() {
    if (state.fanOffTimer !== null) {
        clearTimeout(state.fanOffTimer);
        state.fanOffTimer = null;
        logDebug(
            topics.DO_FAN,
            "Таймер автоматического выключения отменён, " +
            "так как снова появилось требование на работу вентиляции."
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
            setFanState(
                true,
                false,
                getAutomaticOnReason()
            );
        }
        return;
    }
    logDebug(
        topics.DO_FAN,
        "Запущен таймер автоматического включения на " +
        String(delayMilliseconds / 60000) +
        " мин. Текущая причина: " + getAutomaticOnReason()
    );
    state.fanOnTimer = setTimeout(function () {
        state.fanOnTimer = null;
        if (toBoolean(dev[controls.AUTO_MODE]) &&
            state.manualOverride === null &&
            getAutomaticDemand()) {
            /*
             * Причина вычисляется повторно непосредственно перед включением,
             * поскольку за время задержки набор автоматических причин
             * мог измениться.
             */
            setFanState(
                true,
                false,
                getAutomaticOnReason()
            );
            return;
        }
        logDebug(
            topics.DO_FAN,
            "Таймер автоматического включения завершён, " +
            "но условия включения больше не выполняются."
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
        logDebug(
            topics.DO_FAN,
            "Таймер автоматического включения отменён, " +
            "так как автоматическое требование исчезло."
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
            setFanState(
                false,
                false,
                getAutomaticOffReason()
            );
        }
        return;
    }
    logDebug(
        topics.DO_FAN,
        "Запущен таймер автоматического выключения на " +
        String(delayMilliseconds / 60000) +
        " мин. Все автоматические причины отсутствуют."
    );
    state.fanOffTimer = setTimeout(function () {
        state.fanOffTimer = null;
        if (toBoolean(dev[controls.AUTO_MODE]) &&
            state.manualOverride === null &&
            !getAutomaticDemand()) {
            setFanState(
                false,
                false,
                getAutomaticOffReason()
            );
            return;
        }
        logDebug(
            topics.DO_FAN,
            "Таймер автоматического выключения завершён, " +
            "но снова появилась причина для работы вентиляции."
        );
    }, delayMilliseconds);
}
/*
 * Центральная функция согласования управления.
 */
function reconcileFanControl() {
    if (!checkControlAvailable(
        controls.AUTO_MODE,
        true,
        "согласование управления вентиляцией"
    )) {
        return;
    }
    if (!toBoolean(dev[controls.AUTO_MODE])) {
        clearAllTimers();
        if (state.manualOverride !== null) {
            setFanState(
                state.manualOverride,
                false,
                state.manualOverrideReason ||
                "для восстановления ручного состояния при отключённой автоматике."
            );
        }
        return;
    }
    if (state.manualOverride !== null) {
        clearAutomaticTimers();
        setFanState(
            state.manualOverride,
            false,
            state.manualOverrideReason ||
            "для восстановления текущего ручного приоритета."
        );
        syncHumiditySafetyTimer();
        return;
    }
    if (state.humiditySafetyTimer !== null) {
        clearTimeout(state.humiditySafetyTimer);
        state.humiditySafetyTimer = null;
        logDebug(
            topics.DO_FAN,
            "Защитный таймер отменён, так как ручной приоритет отсутствует."
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
        logDebug(
            topics.DO_FAN,
            "Автоматический цикл завершён. Временный ручной приоритет снят."
        );
        state.manualOverride = null;
        state.manualOverrideAutoCycle = false;
        state.manualOverrideReason = null;
        if (state.humiditySafetyTimer !== null) {
            clearTimeout(state.humiditySafetyTimer);
            state.humiditySafetyTimer = null;
        }
        reconcileFanControl();
        return;
    }
    syncHumiditySafetyTimer();
    if (previousAutomaticDemand !== currentAutomaticDemand) {
        logDebug(
            "bathroom_fan",
            "Итоговое автоматическое требование изменилось: " +
            stateToText(previousAutomaticDemand) + " -> " +
            stateToText(currentAutomaticDemand) +
            ". humidityDemand=" + String(state.humidityDemand) +
            ", presenceDemand=" + String(state.presenceDemand) + "."
        );
        reconcileFanControl();
    }
}
/*
 * Пересчитывает требование по влажности.
 */
function refreshHumidityDemand() {
    if (!checkControlAvailable(
        topics.AI_HUMIDITY,
        false,
        "обработка влажности"
    )) {
        return false;
    }
    if (!checkControlAvailable(
        controls.HUMIDITY_MAX,
        false,
        "обработка влажности"
    )) {
        return false;
    }
    if (!checkControlAvailable(
        controls.HUMIDITY_MIN,
        false,
        "обработка влажности"
    )) {
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
            logWarning(
                topics.AI_HUMIDITY,
                "Датчик вернул некорректное значение: '" +
                String(dev[topics.AI_HUMIDITY]) +
                "'. Предыдущее требование по влажности сохранено."
            );
            state.humidityValueErrorLogged = true;
        }
        return false;
    }
    if (state.humidityValueErrorLogged) {
        logInfo(
            topics.AI_HUMIDITY,
            "Корректные данные влажности восстановлены: " +
            String(humidity) + "%."
        );
        state.humidityValueErrorLogged = false;
    }
    var previousHumidityDemand = state.humidityDemand;
    if (humidity >= humidityMax) {
        state.humidityDemand = true;
    } else if (humidity <= humidityMin) {
        state.humidityDemand = false;
    }
    if (previousHumidityDemand !== state.humidityDemand) {
        if (state.humidityDemand) {
            logDebug(
                topics.AI_HUMIDITY,
                "Достигнут верхний порог влажности. Текущее значение=" +
                String(humidity) + "%, верхний порог=" +
                String(humidityMax) + "%."
            );
        } else {
            logDebug(
                topics.AI_HUMIDITY,
                "Достигнут нижний порог влажности. Текущее значение=" +
                String(humidity) + "%, нижний порог=" +
                String(humidityMin) + "%."
            );
        }
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
    handleAutomaticDemandChange(previousAutomaticDemand);
}
/*
 * Устанавливает подтверждённое присутствие.
 */
function setOccupied(newState) {
    var previousAutomaticDemand = getAutomaticDemand();
    var previousPresenceDemand = state.presenceDemand;
    state.occupied = toBoolean(newState);
    if (!checkControlAvailable(
        controls.DOOR_MODE,
        false,
        "расчёт присутствия"
    ) ||
        !checkControlAvailable(
            topics.DI_DOOR_CLOSED,
            false,
            "расчёт присутствия"
        )) {
        state.presenceDemand = false;
        logWarning(
            "bathroom_fan",
            "Требование по присутствию принудительно снято, " +
            "так как необходимые контролы недоступны."
        );
    } else {
        state.presenceDemand = toBoolean(dev[controls.DOOR_MODE]) &&
            toBoolean(dev[topics.DI_DOOR_CLOSED]) &&
            state.occupied;
    }
    if (previousPresenceDemand !== state.presenceDemand) {
        if (state.presenceDemand) {
            logDebug(
                "bathroom_fan",
                "Подтверждено присутствие. Сформировано автоматическое " +
                "требование на работу вентиляции."
            );
        } else {
            logDebug(
                "bathroom_fan",
                "Требование на работу вентиляции по присутствию снято."
            );
        }
    }
    handleAutomaticDemandChange(previousAutomaticDemand);
}
/*
 * Общая функция ручного управления.
 *
 * reason — причина ручной команды без слов
 * "Включено" или "Выключено".
 */
function applyManualFanState(targetFanState, reason) {
    targetFanState = toBoolean(targetFanState);
    if (!reason) {
        reason = "вручную.";
    }
    var automaticDemand = getAutomaticDemand();
    clearAllTimers();
    logDebug(
        topics.DO_FAN,
        "Получена ручная команда " + stateToText(targetFanState) +
        ". Причина: " + reason
    );
    if (!checkControlAvailable(
        controls.AUTO_MODE,
        true,
        "обработка ручной команды"
    )) {
        logError(
            topics.DO_FAN,
            "Ручная команда не выполнена: состояние автоматического режима неизвестно."
        );
        return;
    }
    if (!toBoolean(dev[controls.AUTO_MODE])) {
        state.manualOverride = targetFanState;
        state.manualOverrideAutoCycle = false;
        state.manualOverrideReason = reason;
        setFanState(
            targetFanState,
            true,
            reason
        );
        return;
    }
    /*
     * Ручное OFF при отсутствии автоматических причин
     * не требует постоянного manualOverride.
     */
    if (!targetFanState && !automaticDemand) {
        state.manualOverride = null;
        state.manualOverrideAutoCycle = false;
        state.manualOverrideReason = null;
        setFanState(
            false,
            true,
            reason
        );
        return;
    }
    state.manualOverride = targetFanState;
    state.manualOverrideAutoCycle = automaticDemand;
    state.manualOverrideReason = reason;
    setFanState(
        targetFanState,
        true,
        reason
    );
    syncHumiditySafetyTimer();
}
/*
 * Короткое физическое нажатие.
 */
function applyManualButtonAction() {
    if (!checkControlAvailable(
        topics.DO_FAN,
        true,
        "обработка короткого нажатия настенного выключателя"
    )) {
        logError(
            topics.DI_WALL_SWITCH,
            "Короткое нажатие проигнорировано: фактическое состояние " +
            "вентилятора неизвестно."
        );
        return;
    }
    applyManualFanState(
        !toBoolean(dev[topics.DO_FAN]),
        "вручную коротким нажатием настенного выключателя."
    );
}
/*
 * Изменение автоматического режима.
 */
function handleAutoModeChange(enabled) {
    clearAllTimers();
    enabled = toBoolean(enabled);
    if (enabled) {
        logInfo(
            controls.AUTO_MODE,
            "Автоматический режим включён."
        );
    } else {
        logInfo(
            controls.AUTO_MODE,
            "Автоматический режим выключен."
        );
    }
    if (!enabled) {
        if (!checkControlAvailable(
            topics.DO_FAN,
            true,
            "отключение автоматического режима"
        )) {
            state.manualOverride = null;
            state.manualOverrideAutoCycle = false;
            state.manualOverrideReason = null;
            logWarning(
                controls.AUTO_MODE,
                "Автоматический режим отключён, но фактическое состояние " +
                "вентилятора неизвестно. Ручное состояние не зафиксировано."
            );
            return;
        }
        state.manualOverride = toBoolean(dev[topics.DO_FAN]);
        state.manualOverrideAutoCycle = false;
        state.manualOverrideReason =
            "для восстановления состояния, зафиксированного " +
            "при отключении автоматического режима.";
        return;
    }
    state.manualOverride = null;
    state.manualOverrideAutoCycle = false;
    state.manualOverrideReason = null;
    refreshHumidityDemand();
    if (!checkControlAvailable(
        controls.DOOR_MODE,
        false,
        "включение автоматического режима"
    ) ||
        !checkControlAvailable(
            topics.DI_DOOR_CLOSED,
            false,
            "включение автоматического режима"
        )) {
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
            logDebug(
                controls.FAN_SWITCH,
                "Изменение проигнорировано во время инициализации."
            );
            return;
        }
        var requestedState = toBoolean(newValue);
        /*
         * Служебная синхронизация с физическим реле.
         */
        if (state.fanSwitchSyncPending !== null &&
            requestedState === state.fanSwitchSyncPending) {
            state.fanSwitchSyncPending = null;
            logDebug(
                controls.FAN_SWITCH,
                "Подтверждена служебная синхронизация со значением " +
                stateToText(requestedState) + "."
            );
            return;
        }
        if (state.fanSwitchSyncPending !== null &&
            requestedState !== state.fanSwitchSyncPending) {
            logWarning(
                controls.FAN_SWITCH,
                "Получено неожиданное значение во время служебной синхронизации. " +
                "Ожидалось " + stateToText(state.fanSwitchSyncPending) +
                ", получено " + stateToText(requestedState) + "."
            );
        }
        state.fanSwitchSyncPending = null;
        applyManualFanState(
            requestedState,
            "вручную через виртуальный переключатель."
        );
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
        logInfo(
            "bathroom_fan",
            "Изменены пороги влажности: min=" +
            String(dev[controls.HUMIDITY_MIN]) + "%, max=" +
            String(dev[controls.HUMIDITY_MAX]) + "%."
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
        if (toBoolean(newValue)) {
            logInfo(
                controls.HUMIDITY_SAFETY_MODE,
                "Защита ручного отключения при высокой влажности включена."
            );
        } else {
            logInfo(
                controls.HUMIDITY_SAFETY_MODE,
                "Защита ручного отключения при высокой влажности отключена."
            );
        }
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
        logInfo(
            controls.MANUAL_OFF_HUMIDITY_TIMEOUT,
            "Время защиты изменено: " + String(newValue) + " мин."
        );
        if (state.humiditySafetyTimer !== null) {
            clearTimeout(state.humiditySafetyTimer);
            state.humiditySafetyTimer = null;
            logDebug(
                topics.DO_FAN,
                "Текущий защитный таймер отменён из-за изменения его уставки."
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
        if (!checkControlAvailable(
            controls.DOOR_MODE,
            false,
            "обработка датчика движения"
        )) {
            return;
        }
        if (!toBoolean(dev[controls.DOOR_MODE])) {
            return;
        }
        if (!checkControlAvailable(
            topics.DI_DOOR_CLOSED,
            false,
            "обработка датчика движения"
        )) {
            logWarning(
                topics.DI_MOTION,
                "Обнаружено движение, но состояние двери неизвестно. " +
                "Присутствие не может быть подтверждено."
            );
            return;
        }
        if (!toBoolean(dev[topics.DI_DOOR_CLOSED])) {
            state.motionSeenSinceDoorOpened = true;
            logDebug(
                topics.DI_MOTION,
                "Обнаружено движение при открытой двери. " +
                "Событие сохранено для подтверждения входа."
            );
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
            logDebug(
                topics.DI_DOOR_CLOSED,
                "Дверь открыта. Подтверждённое присутствие сбрасывается."
            );
            setOccupied(false);
            return;
        }
        if (!checkControlAvailable(
            controls.DOOR_MODE,
            false,
            "обработка концевика двери"
        )) {
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
        if (entryConfirmed) {
            logDebug(
                topics.DI_DOOR_CLOSED,
                "Дверь закрыта после свежего события движения. " +
                "Вход подтверждён."
            );
        } else {
            logDebug(
                topics.DI_DOOR_CLOSED,
                "Дверь закрыта без свежего события движения. " +
                "Присутствие не подтверждено."
            );
        }
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
        if (toBoolean(newValue)) {
            logInfo(
                controls.DOOR_MODE,
                "Управление по двери и движению включено."
            );
        } else {
            logInfo(
                controls.DOOR_MODE,
                "Управление по двери и движению отключено."
            );
        }
        if (!toBoolean(newValue)) {
            setOccupied(false);
            return;
        }
        if (!checkControlAvailable(
            topics.DI_DOOR_CLOSED,
            false,
            "включение управления по двери и движению"
        ) ||
            !checkControlAvailable(
                topics.DI_MOTION,
                false,
                "включение управления по двери и движению"
            )) {
            logWarning(
                controls.DOOR_MODE,
                "Управление включено, но один или несколько необходимых " +
                "датчиков недоступны."
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
        logInfo(
            "bathroom_fan",
            "Изменены автоматические задержки: включение=" +
            String(dev[controls.ON_DELAY]) + " мин, выключение=" +
            String(dev[controls.OFF_DELAY]) + " мин."
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
 * 1,5...3 с — игнорируется.
 */
defineRule("bathroom_fan_button", {
    whenChanged: topics.DI_WALL_SWITCH,
    then: function (newValue) {
        if (!state.initialized) {
            return;
        }
        if (toBoolean(newValue)) {
            if (state.buttonPressTime !== 0) {
                logWarning(
                    topics.DI_WALL_SWITCH,
                    "Получено повторное событие нажатия без предшествующего отпускания."
                );
            }
            state.buttonPressTime = Date.now();
            return;
        }
        if (state.buttonPressTime === 0) {
            logWarning(
                topics.DI_WALL_SWITCH,
                "Получено событие отпускания без зарегистрированного нажатия."
            );
            return;
        }
        var pressDuration = Date.now() - state.buttonPressTime;
        state.buttonPressTime = 0;
        if (pressDuration < 0) {
            logError(
                topics.DI_WALL_SWITCH,
                "Получена некорректная длительность нажатия: " +
                String(pressDuration) + " мс."
            );
            return;
        }
        if (pressDuration <= config.SHORT_PRESS_MAX_MS) {
            logDebug(
                topics.DI_WALL_SWITCH,
                "Короткое нажатие: " + String(pressDuration) + " мс."
            );
            applyManualButtonAction();
            return;
        }
        if (pressDuration >= config.LONG_PRESS_MIN_MS) {
            logInfo(
                topics.DI_WALL_SWITCH,
                "Длинное нажатие: " + String(pressDuration) +
                " мс. Выполняется переключение автоматического режима."
            );
            if (!checkControlAvailable(
                controls.AUTO_MODE,
                true,
                "обработка длинного нажатия"
            )) {
                return;
            }
            dev[controls.AUTO_MODE] = !toBoolean(dev[controls.AUTO_MODE]);
            return;
        }
        logDebug(
            topics.DI_WALL_SWITCH,
            "Нажатие длительностью " + String(pressDuration) +
            " мс попало в неиспользуемый диапазон и проигнорировано."
        );
    }
});
/*
 * Обратная связь физического реле.
 *
 * Именно здесь формируется основной INFO-лог:
 *
 * <tsdk> VENTILATION: wb-mr6c_209/K5.
 * Включено/Выключено <причина>.
 *
 * Таким образом, сообщение означает подтверждённое
 * физическое изменение реле.
 */
defineRule("bathroom_fan_relay_feedback", {
    whenChanged: topics.DO_FAN,
    then: function (newValue) {
        if (!state.initialized) {
            return;
        }
        checkControlAvailable(
            topics.DO_FAN,
            true,
            "обработка обратной связи физического реле"
        );
        var actualFanState = toBoolean(newValue);
        /*
         * Если на этапе инициализации состояние реле было неизвестно,
         * первое полученное значение является стартовым состоянием,
         * а не неожиданным внешним изменением.
         */
        if (state.awaitingInitialRelayState &&
            state.lastFanCommandState === null) {
            state.awaitingInitialRelayState = false;
            logInfo(
                topics.DO_FAN,
                "Получено первоначальное физическое состояние: " +
                stateToText(actualFanState) + "."
            );
            syncVirtualFanSwitch();
            if (!toBoolean(dev[controls.AUTO_MODE]) &&
                state.manualOverride === null) {
                state.manualOverride = actualFanState;
                state.manualOverrideAutoCycle = false;
                state.manualOverrideReason =
                    "для восстановления состояния, принятого при запуске " +
                    "в ручном режиме.";
                return;
            }
            reconcileFanControl();
            return;
        }
        /*
         * Подтверждение нашей команды.
         */
        if (state.lastFanCommandState !== null &&
            actualFanState === state.lastFanCommandState) {
            var commandAge = Date.now() - state.lastFanCommandTime;
            var commandReason = state.lastFanCommandReason ||
                "по причине, не указанной вызывающей функцией.";
            if (state.fanAckTimer !== null) {
                clearTimeout(state.fanAckTimer);
                state.fanAckTimer = null;
            }
            /*
             * Главный эксплуатационный лог.
             */
            if (actualFanState) {
                logInfo(
                    topics.DO_FAN,
                    "Включено " + commandReason
                );
            } else {
                logInfo(
                    topics.DO_FAN,
                    "Выключено " + commandReason
                );
            }
            logDebug(
                topics.DO_FAN,
                "Команда подтверждена обратной связью за " +
                String(commandAge) + " мс."
            );
            state.lastFanCommandState = null;
            state.lastFanCommandReason = null;
            state.lastFanCommandTime = 0;
        } else {
            /*
             * Физическое реле изменилось без ожидаемой команды
             * либо пришло не то состояние, которое ожидалось.
             */
            if (state.lastFanCommandState !== null) {
                logWarning(
                    topics.DO_FAN,
                    "Получено неожиданное состояние физического реле. " +
                    "Ожидалось " + stateToText(state.lastFanCommandState) +
                    ", получено " + stateToText(actualFanState) + "."
                );
            } else {
                logWarning(
                    topics.DO_FAN,
                    "Физическое состояние изменилось без ожидаемой команды " +
                    "данного скрипта. Новое состояние: " +
                    stateToText(actualFanState) + "."
                );
            }
            clearFanCommandTracking();
        }
        /*
         * Виртуальный переключатель всегда отражает физический K5.
         */
        syncVirtualFanSwitch();
        /*
         * В ручном режиме первое известное состояние может быть принято
         * как исходный manualOverride.
         */
        if (!toBoolean(dev[controls.AUTO_MODE]) &&
            state.manualOverride === null) {
            state.manualOverride = actualFanState;
            state.manualOverrideAutoCycle = false;
            state.manualOverrideReason =
                "для удержания исходного состояния в ручном режиме.";
            logInfo(
                topics.DO_FAN,
                "Физическое состояние принято как исходное ручное состояние: " +
                stateToText(actualFanState) + "."
            );
            return;
        }
        /*
         * Повторно применяем текущее решение.
         */
        reconcileFanControl();
    }
});
/*
 * Первоначальная инициализация.
 */
function initializeController() {
    logInfo(
        "bathroom_fan",
        "Начата инициализация контроллера вентиляции."
    );
    clearAllTimers();
    clearFanCommandTracking();
    /*
     * Проверяем физический выход.
     */
    if (!checkControlAvailable(
        topics.DO_FAN,
        true,
        "инициализация"
    )) {
        state.awaitingInitialRelayState = true;
        logWarning(
            topics.DO_FAN,
            "Физическое состояние реле пока неизвестно. " +
            "Ожидается первое актуальное значение."
        );
    } else {
        state.awaitingInitialRelayState = false;
    }
    /*
     * Проверяем основные настройки.
     */
    checkControlAvailable(
        controls.AUTO_MODE,
        true,
        "инициализация"
    );
    checkControlAvailable(
        controls.DOOR_MODE,
        false,
        "инициализация"
    );
    checkControlAvailable(
        controls.HUMIDITY_SAFETY_MODE,
        false,
        "инициализация"
    );
    /*
     * Восстанавливаем требование по влажности.
     */
    refreshHumidityDemand();
    /*
     * Проверяем движение.
     */
    if (checkControlAvailable(
        topics.DI_MOTION,
        false,
        "инициализация"
    )) {
        if (toBoolean(dev[topics.DI_MOTION])) {
            state.lastMotionTime = Date.now();
        }
    }
    /*
     * Определяем присутствие.
     */
    if (checkControlAvailable(
        controls.DOOR_MODE,
        false,
        "инициализация присутствия"
    ) &&
        checkControlAvailable(
            topics.DI_DOOR_CLOSED,
            false,
            "инициализация присутствия"
        ) &&
        checkControlAvailable(
            topics.DI_MOTION,
            false,
            "инициализация присутствия"
        )) {
        state.occupied = toBoolean(dev[controls.DOOR_MODE]) &&
            toBoolean(dev[topics.DI_DOOR_CLOSED]) &&
            toBoolean(dev[topics.DI_MOTION]);
    } else {
        state.occupied = false;
        logWarning(
            "bathroom_fan",
            "Присутствие не может быть достоверно определено при запуске, " +
            "так как один или несколько необходимых контролов недоступны."
        );
    }
    state.presenceDemand = state.occupied;
    state.motionSeenSinceDoorOpened = false;
    state.buttonPressTime = 0;
    state.fanSwitchSyncPending = null;
    /*
     * Инициализация ручного состояния.
     */
    if (checkControlAvailable(
        controls.AUTO_MODE,
        true,
        "инициализация автоматического режима"
    )) {
        if (toBoolean(dev[controls.AUTO_MODE])) {
            state.manualOverride = null;
            state.manualOverrideAutoCycle = false;
            state.manualOverrideReason = null;
        } else {
            if (checkControlAvailable(
                topics.DO_FAN,
                true,
                "инициализация ручного режима"
            )) {
                state.manualOverride = toBoolean(dev[topics.DO_FAN]);
                state.manualOverrideReason =
                    "для удержания состояния, восстановленного " +
                    "при запуске в ручном режиме.";
            } else {
                state.manualOverride = null;
                state.manualOverrideReason = null;
                logWarning(
                    topics.DO_FAN,
                    "Скрипт запущен в ручном режиме, но физическое " +
                    "состояние вентилятора пока неизвестно."
                );
            }
            state.manualOverrideAutoCycle = false;
        }
    } else {
        state.manualOverride = null;
        state.manualOverrideAutoCycle = false;
        state.manualOverrideReason = null;
        logError(
            controls.AUTO_MODE,
            "Состояние автоматического режима неизвестно. " +
            "Невозможно гарантированно определить режим управления."
        );
    }
    /*
     * После подготовки внутреннего состояния разрешаем рабочие события.
     */
    state.initialized = true;
    /*
     * Синхронизируем виртуальный переключатель с физическим реле,
     * если состояние реле уже известно.
     */
    syncVirtualFanSwitch();
    /*
     * В автоматическом режиме сразу передаём управление основной логике.
     */
    if (checkControlAvailable(
        controls.AUTO_MODE,
        true,
        "завершение инициализации"
    ) &&
        toBoolean(dev[controls.AUTO_MODE])) {
        reconcileFanControl();
    }
    logInfo(
        "bathroom_fan",
        "Инициализация завершена. autoMode=" +
        String(dev[controls.AUTO_MODE]) +
        ", fan=" + String(dev[topics.DO_FAN]) +
        ", humidityDemand=" + String(state.humidityDemand) +
        ", presenceDemand=" + String(state.presenceDemand) +
        ", manualOverride=" + String(state.manualOverride) + "."
    );
}
/*
 * Даём физическим MQTT-контролам время получить
 * retained/актуальные значения.
 */
setTimeout(initializeController, config.STARTUP_DELAY_MS);