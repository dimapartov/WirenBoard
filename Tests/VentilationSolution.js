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
 *    - задержка автоматического включения задаётся в минутах;
 *    - задержка автоматического выключения задаётся в минутах;
 *    - внутри скрипта значения переводятся в миллисекунды;
 *    - задержка включения применяется только к обычному автоматическому включению;
 *    - задержка выключения применяется после исчезновения последней
 *      автоматической причины;
 *    - если причина исчезла во время задержки включения, включение отменяется;
 *    - если причина появилась во время задержки выключения, выключение отменяется;
 *    - частые сообщения датчика влажности не перезапускают уже активный таймер.
 *
 * 7. Короткое нажатие настенного выключателя и виртуальный переключатель
 *    используют один и тот же механизм ручного управления:
 *    - настенный выключатель переключает текущее фактическое состояние;
 *    - виртуальный переключатель задаёт требуемое состояние напрямую;
 *    - ручная команда выполняется немедленно;
 *    - автоматические таймеры при ручной команде отменяются.
 *
 * 8. Виртуальный переключатель «Вентилятор» одновременно является органом
 *    ручного управления и индикацией фактического состояния реле:
 *    - если реле включилось от автоматики, переключатель станет включённым;
 *    - если реле выключилось, переключатель станет выключенным;
 *    - программная синхронизация переключателя не воспринимается как новая
 *      ручная команда;
 *    - после перезапуска wb-rules сохранённое старое значение переключателя
 *      не используется как команда и заменяется фактическим состоянием реле.
 *
 * 9. Ручной приоритет хранится в трёх состояниях:
 *    - null  — ручного решения нет;
 *    - true  — вентилятор принудительно включён;
 *    - false — вентилятор принудительно выключен.
 *
 *    Если ручная команда была дана во время активной автоматической причины,
 *    она действует до окончания этого автоматического цикла.
 *
 *    Когда исчезает последняя автоматическая причина, временный ручной
 *    приоритет снимается, и следующий цикл снова может управляться автоматикой.
 *
 * 10. Защита от слишком долгого ручного выключения при высокой влажности:
 *     - функцию можно включать и выключать отдельным переключателем
 *       «Защита ручного отключения при высокой влажности»;
 *     - если защита выключена, никакой защитный таймер не запускается;
 *     - если защита включена, пользователь вручную выключил вентилятор,
 *       автоматический режим включён и фактическая влажность непрерывно
 *       остаётся не ниже humidity_max, запускается защитный таймер;
 *     - продолжительность таймера задаётся в минутах;
 *     - после завершения таймера ручной запрет снимается и вентилятор
 *       включается немедленно, без дополнительной задержки включения.
 *
 *     Защитный таймер сбрасывается, если:
 *     - защита отключена виртуальным переключателем;
 *     - влажность опустилась ниже верхнего порога;
 *     - пользователь снова дал ручную команду;
 *     - автоматический режим отключили;
 *     - исчезли все автоматические причины;
 *     - изменили продолжительность защитного таймера.
 *
 *     Если защита впоследствии снова включена при сохраняющихся условиях
 *     ручного выключения и высокой влажности, запускается новый полный отсчёт.
 *
 * 11. Ручное включение при отсутствии автоматических причин сохраняется до
 *     следующей ручной команды или до повторного включения автоматики.
 *
 * 12. При отключении автоматического режима:
 *     - автоматические и защитные таймеры отменяются;
 *     - текущее состояние вентилятора сохраняется как ручное;
 *     - физическая кнопка и виртуальный переключатель напрямую управляют реле;
 *     - влажность, дверь и движение продолжают отслеживаться, но не меняют реле.
 *
 * 13. При повторном включении автоматического режима старый ручной приоритет
 *     сбрасывается, текущие требования пересчитываются и управление передаётся
 *     автоматике.
 *
 * 14. При внешнем изменении реле правило обратной связи синхронизирует
 *     виртуальный переключатель с фактическим состоянием и затем повторно
 *     применяет текущее решение автоматики или ручного приоритета.
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
    STARTUP_DELAY_MS: 2000
};
/*
 * Рабочее виртуальное устройство с настройками автоматики и ручным
 * переключателем вентилятора.
 *
 * forceDefault не используется, поэтому значения сохраняются между
 * перезапусками wb-rules.
 *
 * Исключением с точки зрения логики является fan_switch:
 * после запуска его сохранённое значение не используется как команда,
 * а заменяется фактическим состоянием физического реле.
 */
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
        /*
         * Все пользовательские выдержки времени задаются в минутах.
         * 0.17 минуты приблизительно соответствует 10 секундам.
         */
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
        /*
         * Разрешает или запрещает защиту от слишком долгого
         * ручного выключения вентилятора при высокой влажности.
         */
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
    /*
     * Пока initialized=false, стартовые retained-события не должны
     * запускать рабочую автоматику.
     */
    initialized: false,
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
    /*
     * Используется для различения пользовательского изменения виртуального
     * переключателя и программной синхронизации с физическим реле.
     */
    fanSwitchSyncPending: null,
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
        return value === "1" || value === "true" || value === "on";
    }
    return false;
}
/*
 * Преобразует значение аналогового контрола к числу.
 * Поддерживает дробные значения как с точкой, так и с запятой.
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
 * Читает время из виртуального устройства в минутах
 * и переводит его в миллисекунды для setTimeout().
 *
 * Некорректное или отрицательное значение воспринимается
 * как нулевая задержка.
 */
function getDelayMilliseconds(controlName) {
    var minutes = toNumber(dev[controlName]);
    if (isNaN(minutes) || minutes < 0) {
        return 0;
    }
    return Math.round(minutes * 60 * 1000);
}
/*
 * Возвращает итоговое автоматическое требование.
 * Вентиляция нужна при высокой влажности ИЛИ подтверждённом присутствии.
 */
function getAutomaticDemand() {
    return state.humidityDemand || state.presenceDemand;
}
/*
 * Отменяет оба обычных автоматических таймера.
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
 * Отменяет все таймеры скрипта:
 * - автоматическое включение;
 * - автоматическое выключение;
 * - защиту ручного выключения при высокой влажности.
 */
function clearAllTimers() {
    clearAutomaticTimers();
    if (state.humiditySafetyTimer !== null) {
        clearTimeout(state.humiditySafetyTimer);
        state.humiditySafetyTimer = null;
    }
}
/*
 * Отправляет требуемое состояние физическому реле.
 *
 * В обычной автоматике команда публикуется только при отличии
 * фактического состояния от требуемого.
 *
 * При ручной команде forceWrite=true позволяет отправить команду даже тогда,
 * когда фактическое значение ещё не успело измениться после предыдущей команды.
 */
function setFanState(newState, forceWrite) {
    newState = toBoolean(newState);
    if (forceWrite || toBoolean(dev[topics.DO_FAN]) !== newState) {
        dev[topics.DO_FAN] = newState;
    }
}
/*
 * Синхронизирует виртуальный переключатель «Вентилятор»
 * с фактическим состоянием физического реле.
 */
function syncVirtualFanSwitch() {
    var fanValue = dev[topics.DO_FAN];
    if (fanValue === undefined || fanValue === null) {
        return;
    }
    var actualFanState = toBoolean(fanValue);
    if (toBoolean(dev[controls.FAN_SWITCH]) === actualFanState) {
        return;
    }
    /*
     * Запоминаем, что следующее изменение fan_switch вызвано самим скриптом.
     */
    state.fanSwitchSyncPending = actualFanState;
    dev[controls.FAN_SWITCH] = actualFanState;
}
/*
 * Проверяет, находится ли фактическая влажность не ниже верхнего порога.
 * Заодно проверяет корректность обоих порогов гистерезиса.
 */
function isHumidityAtOrAboveUpperThreshold() {
    var humidity = toNumber(dev[topics.AI_HUMIDITY]);
    var humidityMax = toNumber(dev[controls.HUMIDITY_MAX]);
    var humidityMin = toNumber(dev[controls.HUMIDITY_MIN]);
    return !isNaN(humidity) &&
        !isNaN(humidityMax) &&
        !isNaN(humidityMin) &&
        humidityMin < humidityMax &&
        humidity >= humidityMax;
}
/*
 * Синхронизирует защитный таймер ручного выключения при высокой влажности.
 *
 * Защитный таймер существует только при одновременном выполнении условий:
 * - автоматический режим включён;
 * - защита ручного отключения включена;
 * - действует ручное принудительное выключение;
 * - фактическая влажность не ниже humidity_max.
 */
function syncHumiditySafetyTimer() {
    var timerRequired = toBoolean(dev[controls.AUTO_MODE]) &&
        toBoolean(dev[controls.HUMIDITY_SAFETY_MODE]) &&
        state.manualOverride === false &&
        isHumidityAtOrAboveUpperThreshold();
    /*
     * Если хотя бы одно необходимое условие исчезло,
     * защитный таймер больше не нужен.
     */
    if (!timerRequired) {
        if (state.humiditySafetyTimer !== null) {
            clearTimeout(state.humiditySafetyTimer);
            state.humiditySafetyTimer = null;
        }
        return;
    }
    /*
     * Если таймер уже идёт, новые сообщения влажности
     * не начинают отсчёт заново.
     */
    if (state.humiditySafetyTimer !== null) {
        return;
    }
    var delayMilliseconds = getDelayMilliseconds(controls.MANUAL_OFF_HUMIDITY_TIMEOUT);
    /*
     * Нулевое время означает немедленное снятие ручного запрета.
     */
    if (delayMilliseconds === 0) {
        state.manualOverride = null;
        state.manualOverrideAutoCycle = false;
        clearAutomaticTimers();
        setFanState(true, false);
        return;
    }
    state.humiditySafetyTimer = setTimeout(function () {
        state.humiditySafetyTimer = null;
        /*
         * После завершения выдержки повторно проверяем все условия,
         * включая то, что сама защитная функция всё ещё включена.
         */
        var conditionsStillValid = toBoolean(dev[controls.AUTO_MODE]) &&
            toBoolean(dev[controls.HUMIDITY_SAFETY_MODE]) &&
            state.manualOverride === false &&
            isHumidityAtOrAboveUpperThreshold();
        if (!conditionsStillValid) {
            return;
        }
        state.manualOverride = null;
        state.manualOverrideAutoCycle = false;
        clearAutomaticTimers();
        /*
         * Защитный таймер уже является выдержкой времени,
         * поэтому дополнительная задержка включения не применяется.
         */
        setFanState(true, false);
    }, delayMilliseconds);
}
/*
 * Запускает автоматическое включение вентилятора
 * с выдержкой времени, заданной в минутах.
 *
 * Повторные события не создают второй таймер
 * и не начинают отсчёт заново.
 */
function requestAutomaticFanOn() {
    /*
     * Если шёл отсчёт выключения, он больше не нужен.
     */
    if (state.fanOffTimer !== null) {
        clearTimeout(state.fanOffTimer);
        state.fanOffTimer = null;
    }
    /*
     * При ручном приоритете или уже включённом вентиляторе
     * автоматический таймер включения не нужен.
     */
    if (state.manualOverride !== null || toBoolean(dev[topics.DO_FAN])) {
        if (state.fanOnTimer !== null) {
            clearTimeout(state.fanOnTimer);
            state.fanOnTimer = null;
        }
        return;
    }
    /*
     * Уже запущенный таймер не перезапускается.
     */
    if (state.fanOnTimer !== null) {
        return;
    }
    var delayMilliseconds = getDelayMilliseconds(controls.ON_DELAY);
    /*
     * При нулевой выдержке включаем сразу.
     */
    if (delayMilliseconds === 0) {
        if (toBoolean(dev[controls.AUTO_MODE]) &&
            state.manualOverride === null &&
            getAutomaticDemand()) {
            setFanState(true, false);
        }
        return;
    }
    state.fanOnTimer = setTimeout(function () {
        state.fanOnTimer = null;
        /*
         * Перед фактическим включением ещё раз проверяем,
         * что причина никуда не исчезла.
         */
        if (toBoolean(dev[controls.AUTO_MODE]) &&
            state.manualOverride === null &&
            getAutomaticDemand()) {
            setFanState(true, false);
        }
    }, delayMilliseconds);
}
/*
 * Запускает автоматическое выключение вентилятора
 * с выдержкой времени, заданной в минутах.
 */
function requestAutomaticFanOff() {
    /*
     * Если шёл отсчёт включения, он больше не нужен.
     */
    if (state.fanOnTimer !== null) {
        clearTimeout(state.fanOnTimer);
        state.fanOnTimer = null;
    }
    /*
     * При ручном приоритете или уже выключенном вентиляторе
     * автоматический таймер выключения не нужен.
     */
    if (state.manualOverride !== null || !toBoolean(dev[topics.DO_FAN])) {
        if (state.fanOffTimer !== null) {
            clearTimeout(state.fanOffTimer);
            state.fanOffTimer = null;
        }
        return;
    }
    /*
     * Уже запущенный таймер не перезапускается.
     */
    if (state.fanOffTimer !== null) {
        return;
    }
    var delayMilliseconds = getDelayMilliseconds(controls.OFF_DELAY);
    /*
     * При нулевой выдержке выключаем сразу.
     */
    if (delayMilliseconds === 0) {
        if (toBoolean(dev[controls.AUTO_MODE]) &&
            state.manualOverride === null &&
            !getAutomaticDemand()) {
            setFanState(false, false);
        }
        return;
    }
    state.fanOffTimer = setTimeout(function () {
        state.fanOffTimer = null;
        /*
         * Перед выключением повторно проверяем,
         * что автоматических причин действительно нет.
         */
        if (toBoolean(dev[controls.AUTO_MODE]) &&
            state.manualOverride === null &&
            !getAutomaticDemand()) {
            setFanState(false, false);
        }
    }, delayMilliseconds);
}
/*
 * Согласует фактическое состояние вентилятора со всеми текущими условиями.
 *
 * Приоритеты:
 * 1. Отключённый автоматический режим.
 * 2. Ручной приоритет.
 * 3. Автоматические требования:
 *    - влажность;
 *    - присутствие.
 */
function reconcileFanControl() {
    /*
     * В полностью ручном режиме обычная автоматика не должна управлять реле.
     */
    if (!toBoolean(dev[controls.AUTO_MODE])) {
        clearAllTimers();
        if (state.manualOverride !== null) {
            setFanState(state.manualOverride, false);
        }
        return;
    }
    /*
     * Ручной приоритет выше обычной автоматики.
     */
    if (state.manualOverride !== null) {
        clearAutomaticTimers();
        setFanState(state.manualOverride, false);
        /*
         * При ручном OFF здесь при необходимости запускается защитный таймер.
         * Если защита отключена, функция просто убедится, что таймера нет.
         */
        syncHumiditySafetyTimer();
        return;
    }
    /*
     * Без ручного приоритета защитный таймер не нужен.
     */
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
 * После изменения влажности или присутствия проверяет,
 * закончился ли автоматический цикл, в котором пользователь
 * задал ручной приоритет.
 */
function handleAutomaticDemandChange(previousAutomaticDemand) {
    var currentAutomaticDemand = getAutomaticDemand();
    /*
     * Если ручное решение относилось к текущему автоматическому циклу,
     * то после исчезновения последней автоматической причины
     * оно автоматически снимается.
     */
    if (state.manualOverride !== null &&
        state.manualOverrideAutoCycle &&
        !currentAutomaticDemand) {
        state.manualOverride = null;
        state.manualOverrideAutoCycle = false;
        if (state.humiditySafetyTimer !== null) {
            clearTimeout(state.humiditySafetyTimer);
            state.humiditySafetyTimer = null;
        }
        reconcileFanControl();
        return;
    }
    /*
     * Защитный таймер необходимо проверять даже тогда,
     * когда итоговое автоматическое требование не изменилось.
     */
    syncHumiditySafetyTimer();
    if (previousAutomaticDemand !== currentAutomaticDemand) {
        reconcileFanControl();
    }
}
/*
 * Пересчитывает требование по влажности с гистерезисом.
 *
 * При некорректных порогах или отсутствии данных датчика
 * текущее требование не сбрасывается.
 */
function refreshHumidityDemand() {
    var humidity = toNumber(dev[topics.AI_HUMIDITY]);
    var humidityMax = toNumber(dev[controls.HUMIDITY_MAX]);
    var humidityMin = toNumber(dev[controls.HUMIDITY_MIN]);
    /*
     * Проверяем корректность уставок.
     */
    if (isNaN(humidityMax) || isNaN(humidityMin) || humidityMin >= humidityMax) {
        if (!state.thresholdsErrorLogged) {
            log(
                "bathroom_fan: неверные пороги влажности: min={}, max={}",
                humidityMin,
                humidityMax
            );
            state.thresholdsErrorLogged = true;
        }
        return false;
    }
    state.thresholdsErrorLogged = false;
    /*
     * Если датчик влажности недоступен, сохранённое требование не изменяем.
     * Работа по двери и движению при этом продолжает работать независимо.
     */
    if (isNaN(humidity)) {
        return false;
    }
    var previousHumidityDemand = state.humidityDemand;
    /*
     * Верхний порог включает требование.
     * Нижний порог снимает требование.
     * Между порогами состояние сохраняется.
     */
    if (humidity >= humidityMax) {
        state.humidityDemand = true;
    } else if (humidity <= humidityMin) {
        state.humidityDemand = false;
    }
    return previousHumidityDemand !== state.humidityDemand;
}
/*
 * Обрабатывает новое показание влажности
 * или изменение её порогов.
 */
function processHumidityChange() {
    var previousAutomaticDemand = getAutomaticDemand();
    var demandChanged = refreshHumidityDemand();
    /*
     * Даже если humidityDemand не изменился,
     * фактическая влажность могла перейти через humidity_max,
     * что важно для защитного таймера.
     */
    if (!demandChanged) {
        syncHumiditySafetyTimer();
        return;
    }
    handleAutomaticDemandChange(previousAutomaticDemand);
}
/*
 * Устанавливает подтверждённое присутствие
 * и пересчитывает требование по двери и движению.
 */
function setOccupied(newState) {
    var previousAutomaticDemand = getAutomaticDemand();
    state.occupied = toBoolean(newState);
    state.presenceDemand = toBoolean(dev[controls.DOOR_MODE]) &&
        toBoolean(dev[topics.DI_DOOR_CLOSED]) &&
        state.occupied;
    handleAutomaticDemandChange(previousAutomaticDemand);
}
/*
 * Выполняет общую ручную команду для вентилятора.
 *
 * Эту функцию используют:
 * - настенный пружинный выключатель;
 * - виртуальный переключатель «Вентилятор».
 */
function applyManualFanState(targetFanState) {
    targetFanState = toBoolean(targetFanState);
    var automaticDemand = getAutomaticDemand();
    /*
     * Любая новая ручная команда отменяет все предыдущие выдержки времени.
     */
    clearAllTimers();
    /*
     * Если автоматический режим полностью выключен,
     * команда становится постоянным ручным состоянием.
     */
    if (!toBoolean(dev[controls.AUTO_MODE])) {
        state.manualOverride = targetFanState;
        state.manualOverrideAutoCycle = false;
        setFanState(targetFanState, true);
        return;
    }
    /*
     * Если вентилятор вручную выключается при отсутствии автоматических причин,
     * постоянный ручной запрет не нужен.
     */
    if (!targetFanState && !automaticDemand) {
        state.manualOverride = null;
        state.manualOverrideAutoCycle = false;
        setFanState(false, true);
        return;
    }
    /*
     * Во всех остальных случаях сохраняем полноценный ручной приоритет.
     */
    state.manualOverride = targetFanState;
    state.manualOverrideAutoCycle = automaticDemand;
    setFanState(targetFanState, true);
    /*
     * Если это ручное OFF при высокой влажности,
     * защитный таймер запустится только при включённой защите.
     */
    syncHumiditySafetyTimer();
}
/*
 * Выполняет короткое нажатие настенного выключателя.
 *
 * Физическая кнопка инвертирует фактическое состояние вентилятора
 * и передаёт результат в общий механизм ручного управления.
 */
function applyManualButtonAction() {
    applyManualFanState(!toBoolean(dev[topics.DO_FAN]));
}
/*
 * Обрабатывает включение и выключение автоматического режима.
 */
function handleAutoModeChange(enabled) {
    clearAllTimers();
    /*
     * При выключении автоматики сохраняем фактическое состояние реле
     * как ручное.
     */
    if (!toBoolean(enabled)) {
        var fanValue = dev[topics.DO_FAN];
        if (fanValue === undefined || fanValue === null) {
            state.manualOverride = null;
        } else {
            state.manualOverride = toBoolean(fanValue);
        }
        state.manualOverrideAutoCycle = false;
        return;
    }
    /*
     * При повторном включении автоматики старый ручной приоритет сбрасывается.
     */
    state.manualOverride = null;
    state.manualOverrideAutoCycle = false;
    refreshHumidityDemand();
    state.presenceDemand = toBoolean(dev[controls.DOOR_MODE]) &&
        toBoolean(dev[topics.DI_DOOR_CLOSED]) &&
        state.occupied;
    reconcileFanControl();
}
/*
 * Реагирует на изменение виртуального переключателя «Вентилятор».
 *
 * Если изменение было создано самим скриптом при синхронизации
 * с физическим реле, оно не рассматривается как ручная команда.
 */
defineRule("bathroom_fan_virtual_switch", {
    whenChanged: controls.FAN_SWITCH,
    then: function (newValue) {
        if (!state.initialized) {
            return;
        }
        var requestedState = toBoolean(newValue);
        /*
         * Служебная синхронизация.
         */
        if (state.fanSwitchSyncPending !== null &&
            requestedState === state.fanSwitchSyncPending) {
            state.fanSwitchSyncPending = null;
            return;
        }
        /*
         * Любое другое изменение считается пользовательской ручной командой.
         */
        state.fanSwitchSyncPending = null;
        applyManualFanState(requestedState);
    }
});
/*
 * Реагирует на изменение показаний датчика влажности.
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
 * Пересчитывает влажностную автоматику
 * при изменении верхнего или нижнего порога.
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
        processHumidityChange();
    }
});
/*
 * Включает или отключает защиту ручного выключения при высокой влажности.
 *
 * При выключении активный защитный таймер немедленно отменяется.
 *
 * При включении, если вентилятор сейчас принудительно выключен вручную
 * и влажность остаётся высокой, запускается новый полный защитный отсчёт.
 */
defineRule("bathroom_fan_humidity_safety_mode", {
    whenChanged: controls.HUMIDITY_SAFETY_MODE,
    then: function () {
        if (!state.initialized) {
            return;
        }
        syncHumiditySafetyTimer();
    }
});
/*
 * При изменении допустимого времени ручного выключения
 * активный защитный отсчёт начинается заново с нового полного значения.
 *
 * Если защита отключена, новый таймер не запускается.
 */
defineRule("bathroom_fan_humidity_safety_timeout", {
    whenChanged: controls.MANUAL_OFF_HUMIDITY_TIMEOUT,
    then: function () {
        if (!state.initialized) {
            return;
        }
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
 * Движение при открытой двери запоминается для подтверждения входа.
 * Движение при закрытой двери сразу подтверждает присутствие.
 */
defineRule("bathroom_fan_motion", {
    whenChanged: topics.DI_MOTION,
    then: function (newValue) {
        if (!state.initialized) {
            return;
        }
        /*
         * Интересует только появление движения.
         */
        if (!toBoolean(newValue)) {
            return;
        }
        state.lastMotionTime = Date.now();
        /*
         * Если управление по присутствию отключено,
         * больше ничего делать не нужно.
         */
        if (!toBoolean(dev[controls.DOOR_MODE])) {
            return;
        }
        /*
         * Движение при открытой двери запоминаем как возможный вход.
         */
        if (!toBoolean(dev[topics.DI_DOOR_CLOSED])) {
            state.motionSeenSinceDoorOpened = true;
            return;
        }
        /*
         * Движение при закрытой двери подтверждает присутствие.
         */
        setOccupied(true);
    }
});
/*
 * Обрабатывает концевик двери.
 *
 * Открытие двери сбрасывает присутствие.
 *
 * Закрытие подтверждает новый вход только при наличии
 * свежего движения, зарегистрированного после открытия двери.
 */
defineRule("bathroom_fan_door", {
    whenChanged: topics.DI_DOOR_CLOSED,
    then: function (newValue) {
        if (!state.initialized) {
            return;
        }
        var doorClosed = toBoolean(newValue);
        /*
         * Дверь открылась — человек больше
         * не считается подтверждённо находящимся внутри.
         */
        if (!doorClosed) {
            state.motionSeenSinceDoorOpened = false;
            setOccupied(false);
            return;
        }
        /*
         * Если управление по двери отключено,
         * присутствие не используется.
         */
        if (!toBoolean(dev[controls.DOOR_MODE])) {
            setOccupied(false);
            return;
        }
        /*
         * Подтверждаем вход только если после открытия двери
         * было движение и оно произошло не более 30 секунд назад.
         */
        var entryConfirmed = state.motionSeenSinceDoorOpened &&
            state.lastMotionTime > 0 &&
            Date.now() - state.lastMotionTime <= config.ENTRY_CONFIRM_TIME_MS;
        state.motionSeenSinceDoorOpened = false;
        setOccupied(entryConfirmed);
    }
});
/*
 * Включает или отключает использование двери и движения.
 *
 * При отключении присутствие полностью сбрасывается.
 *
 * При включении закрытая дверь и активное движение
 * сразу считаются подтверждённым присутствием.
 */
defineRule("bathroom_fan_door_mode", {
    whenChanged: controls.DOOR_MODE,
    then: function (newValue) {
        if (!state.initialized) {
            return;
        }
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
 * При изменении задержки автоматического включения или выключения
 * отменяет старый отсчёт и создаёт новый согласно текущему состоянию.
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
        clearAutomaticTimers();
        reconcileFanControl();
    }
});
/*
 * Обрабатывает переключатель автоматического режима.
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
 * Различает короткое и длинное нажатие настенного пружинного выключателя.
 *
 * До 1,5 секунды включительно:
 * - ручное переключение вентилятора.
 *
 * От 3 секунд:
 * - переключение автоматического режима.
 *
 * Интервал от 1,5 до 3 секунд игнорируется.
 */
defineRule("bathroom_fan_button", {
    whenChanged: topics.DI_WALL_SWITCH,
    then: function (newValue) {
        if (!state.initialized) {
            return;
        }
        /*
         * Начало нажатия.
         */
        if (toBoolean(newValue)) {
            state.buttonPressTime = Date.now();
            return;
        }
        /*
         * Если начала нажатия не было зарегистрировано,
         * отпускание игнорируем.
         */
        if (state.buttonPressTime === 0) {
            return;
        }
        var pressDuration = Date.now() - state.buttonPressTime;
        state.buttonPressTime = 0;
        /*
         * Короткое нажатие.
         */
        if (pressDuration <= config.SHORT_PRESS_MAX_MS) {
            applyManualButtonAction();
            return;
        }
        /*
         * Длинное нажатие.
         */
        if (pressDuration >= config.LONG_PRESS_MIN_MS) {
            dev[controls.AUTO_MODE] = !toBoolean(dev[controls.AUTO_MODE]);
        }
    }
});
/*
 * Контролирует фактические изменения физического реле.
 *
 * Сначала синхронизирует виртуальный переключатель
 * с фактическим состоянием.
 *
 * Затем повторно применяет ручной приоритет или решение автоматики,
 * если реле было изменено извне.
 */
defineRule("bathroom_fan_relay_feedback", {
    whenChanged: topics.DO_FAN,
    then: function (newValue) {
        if (!state.initialized) {
            return;
        }
        syncVirtualFanSwitch();
        /*
         * Если автоматический режим выключен,
         * а при инициализации состояние реле ещё было неизвестно,
         * первое полученное состояние принимается как исходное ручное.
         */
        if (!toBoolean(dev[controls.AUTO_MODE]) &&
            state.manualOverride === null) {
            state.manualOverride = toBoolean(newValue);
            state.manualOverrideAutoCycle = false;
            return;
        }
        reconcileFanControl();
    }
});
/*
 * Выполняет первоначальную инициализацию после запуска wb-rules.
 *
 * До завершения функции все whenChanged-обработчики игнорируют
 * стартовые retained-события.
 *
 * Это особенно важно для виртуального переключателя вентилятора:
 * сохранённое до перезапуска значение fan_switch не должно
 * восприниматься как новая ручная команда.
 */
function initializeController() {
    clearAllTimers();
    /*
     * Первоначально восстанавливаем требование
     * по текущему значению влажности.
     */
    var humidity = toNumber(dev[topics.AI_HUMIDITY]);
    var humidityMax = toNumber(dev[controls.HUMIDITY_MAX]);
    var humidityMin = toNumber(dev[controls.HUMIDITY_MIN]);
    if (!isNaN(humidity) &&
        !isNaN(humidityMax) &&
        !isNaN(humidityMin) &&
        humidityMin < humidityMax) {
        if (humidity >= humidityMax) {
            state.humidityDemand = true;
        } else if (humidity <= humidityMin) {
            state.humidityDemand = false;
        }
    }
    /*
     * Если при запуске уже присутствует движение,
     * запоминаем его время.
     */
    if (toBoolean(dev[topics.DI_MOTION])) {
        state.lastMotionTime = Date.now();
    }
    /*
     * При запуске присутствие подтверждается, только если:
     * - управление по присутствию включено;
     * - дверь закрыта;
     * - датчик движения сейчас активен.
     */
    state.occupied = toBoolean(dev[controls.DOOR_MODE]) &&
        toBoolean(dev[topics.DI_DOOR_CLOSED]) &&
        toBoolean(dev[topics.DI_MOTION]);
    state.presenceDemand = state.occupied;
    state.motionSeenSinceDoorOpened = false;
    state.buttonPressTime = 0;
    state.fanSwitchSyncPending = null;
    /*
     * В автоматическом режиме старый ручной приоритет
     * после перезапуска не восстанавливается.
     */
    if (toBoolean(dev[controls.AUTO_MODE])) {
        state.manualOverride = null;
        state.manualOverrideAutoCycle = false;
    } else {
        /*
         * В ручном режиме сохраняем фактическое состояние вентилятора.
         */
        var fanValue = dev[topics.DO_FAN];
        if (fanValue === undefined || fanValue === null) {
            /*
             * Фактическое состояние пока неизвестно.
             * Первое полученное состояние реле будет принято
             * в bathroom_fan_relay_feedback.
             */
            state.manualOverride = null;
        } else {
            state.manualOverride = toBoolean(fanValue);
        }
        state.manualOverrideAutoCycle = false;
    }
    /*
     * После подготовки внутреннего состояния
     * разрешаем обработку рабочих событий.
     */
    state.initialized = true;
    /*
     * Сохранённое значение виртуального переключателя
     * заменяется фактическим состоянием реле.
     *
     * Это изменение не станет ручной командой,
     * так как syncVirtualFanSwitch() выставит fanSwitchSyncPending.
     */
    syncVirtualFanSwitch();
    /*
     * В автоматическом режиме сразу передаём
     * управление основной логике.
     */
    if (toBoolean(dev[controls.AUTO_MODE])) {
        reconcileFanControl();
    }
}
/*
 * Начальная задержка используется только для того,
 * чтобы дать физическим MQTT-контролам время получить
 * сохранённые/фактические значения после запуска wb-rules.
 *
 * Все пользовательские выдержки времени задаются
 * в виртуальном устройстве в минутах.
 */
setTimeout(initializeController, config.STARTUP_DELAY_MS);