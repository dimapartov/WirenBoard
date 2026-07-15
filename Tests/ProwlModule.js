// /etc/wb-rules-modules/ProwlModule.js

// ============================================================================
// МОДУЛЬ ОТПРАВКИ УВЕДОМЛЕНИЙ В PROWL
//
// Уведомление отправляется при помощи системной команды curl.
//
// Тело POST-запроса не вставляется непосредственно в командную строку,
// а передаётся curl через стандартный ввод stdin.
//
// Это сделано для того, чтобы:
// - не экранировать вручную кавычки;
// - корректно передавать пробелы;
// - корректно передавать кириллицу;
// - не допускать выполнения содержимого сообщения как shell-команды;
// - корректно передавать символы &, =, ?, %, переносы строк и другие
//   специальные символы.
//
// Для использования необходимо:
// 1. Установить API-ключ Prowl в PROWL_API_KEY.
// 2. Подключить модуль в основном скрипте:
//
//      var Prowl = require("prowl");
//
// 3. Отправить сообщение:
//
//      Prowl.send(
//          "Вытяжка включена",
//          "Влажность достигла верхнего порога",
//          0
//      );
// ============================================================================


// ============================================================================
// 1. НАСТРОЙКИ PROWL
// ============================================================================

// API-ключ пользователя Prowl
var PROWL_API_KEY = "SECRET_TOKEN";

// Имя приложения, которое будет показано в уведомлении
var PROWL_APP_NAME = "WirenBoardTest";

// Адрес API отправки уведомлений
var PROWL_API_URL = "https://api.prowlapp.com/publicapi/add";

// Максимальное время выполнения HTTP-запроса, секунд
var CURL_TIMEOUT_SECONDS = 15;


// ============================================================================
// 2. КОДИРОВАНИЕ ПАРАМЕТРОВ
// ============================================================================

/*
 * Кодирует значение для передачи в формате
 * application/x-www-form-urlencoded.
 *
 * Например:
 *
 *   Влажность 75%
 *
 * преобразуется в URL-кодированную строку.
 */
function enc(value) {
    if (value === undefined || value === null) {
        return "";
    }

    return encodeURIComponent(String(value));
}


/*
 * Формирует тело POST-запроса из объекта параметров.
 *
 * Результат имеет вид:
 *
 * apikey=...&application=WirenBoard&event=...&description=...
 *
 * Пустые и неопределённые необязательные параметры не добавляются.
 */
function makeFormBody(params) {
    var parts = [];

    for (var key in params) {
        if (!params.hasOwnProperty(key)) {
            continue;
        }

        var value = params[key];

        if (
            value === undefined ||
            value === null ||
            value === ""
        ) {
            continue;
        }

        parts.push(enc(key) + "=" + enc(value));
    }

    return parts.join("&");
}


// ============================================================================
// 3. ОГРАНИЧЕНИЕ ПРИОРИТЕТА
// ============================================================================

/*
 * Prowl поддерживает приоритеты от -2 до 2.
 *
 * Если приоритет не передан, используется 0.
 * Если передано значение вне диапазона, оно ограничивается.
 */
function normalizePriority(priority) {
    if (priority === undefined || priority === null) {
        return 0;
    }

    priority = Number(priority);

    if (isNaN(priority)) {
        return 0;
    }

    if (priority < -2) {
        return -2;
    }

    if (priority > 2) {
        return 2;
    }

    return priority;
}


// ============================================================================
// 4. ОТПРАВКА УВЕДОМЛЕНИЯ
// ============================================================================

/*
 * Отправляет уведомление в Prowl.
 *
 * Параметры:
 *
 * event:
 *   Краткое название события.
 *
 * description:
 *   Полное описание события.
 *
 * priority:
 *   Приоритет от -2 до 2.
 *   Необязательный параметр, по умолчанию 0.
 *
 * url:
 *   Ссылка, которая может отображаться в уведомлении.
 *   Необязательный параметр.
 *
 * Пример:
 *
 * Prowl.send(
 *     "Высокая влажность",
 *     "Влажность в ванной достигла 75%",
 *     1,
 *     "http://192.168.1.10"
 * );
 */
exports.send = function(event, description, priority, url) {
    priority = normalizePriority(priority);

    /*
     * Формируем тело POST-запроса.
     *
     * Все значения кодируются через encodeURIComponent(),
     * поэтому специальные символы не нарушают структуру запроса.
     */
    var body = makeFormBody({
        apikey: PROWL_API_KEY,
        application: PROWL_APP_NAME,
        event: event,
        description: description,
        priority: priority,
        url: url
    });

    /*
     * Команда curl.
     *
     * Параметры:
     *
     * --silent
     *   Не выводить индикатор прогресса.
     *
     * --show-error
     *   Показывать описание ошибки даже в тихом режиме.
     *
     * --fail
     *   Возвращать ненулевой код при HTTP-ошибке 4xx или 5xx.
     *
     * --max-time
     *   Ограничить общее время выполнения запроса.
     *
     * --request POST
     *   Использовать метод POST.
     *
     * --header
     *   Указать формат тела запроса.
     *
     * --data-binary @-
     *   Прочитать тело POST-запроса из стандартного ввода stdin.
     *
     * Текст event и description не вставляется в эту команду,
     * поэтому пользовательские данные не могут изменить shell-команду.
     */
    var command =
        "/usr/bin/curl" +
        " --silent" +
        " --show-error" +
        " --fail" +
        " --max-time " + CURL_TIMEOUT_SECONDS +
        " --request POST" +
        " --header 'Content-Type: application/x-www-form-urlencoded; charset=utf-8'" +
        " --data-binary @-" +
        " '" + PROWL_API_URL + "'";

    /*
     * runShellCommand выполняет команду асинхронно.
     *
     * input:
     *   Передаёт сформированное тело запроса в stdin процесса curl.
     *
     * captureOutput:
     *   Сохраняет ответ API из stdout.
     *
     * captureErrorOutput:
     *   Сохраняет диагностический вывод curl из stderr.
     *
     * exitCallback:
     *   Вызывается после завершения curl.
     */
    runShellCommand(command, {
        input: body,
        captureOutput: true,
        captureErrorOutput: true,

        exitCallback: function(
            exitCode,
            capturedOutput,
            capturedErrorOutput
        ) {
            /*
             * Код возврата 0 означает, что curl успешно выполнил запрос.
             */
            if (exitCode === 0) {
                log(
                    "Prowl notification sent: {}",
                    String(event)
                );

                /*
                 * При необходимости ответ Prowl можно вывести
                 * в отладочный лог.
                 *
                 * Обычно Prowl возвращает XML.
                 */
                if (capturedOutput) {
                    log.debug(
                        "Prowl response: {}",
                        String(capturedOutput)
                    );
                }

                return;
            }

            /*
             * Ненулевой код возврата означает ошибку curl:
             *
             * - отсутствие интернета;
             * - ошибка DNS;
             * - тайм-аут;
             * - ошибка TLS;
             * - HTTP-ответ 4xx или 5xx;
             * - неверный API-ключ;
             * - другая ошибка передачи.
             */
            var errorText = capturedErrorOutput;

            if (!errorText) {
                errorText = capturedOutput;
            }

            if (!errorText) {
                errorText = "curl exit code " + exitCode;
            }

            log.error(
                "Prowl notification error. Event: {}, code: {}, error: {}",
                String(event),
                exitCode,
                String(errorText)
            );
        }
    });
};