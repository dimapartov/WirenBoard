defineRule("leakageNotification", {
    whenChanged: [
        "Leakage sensor-1 (стиральная машина)/water_leak",
        "Leakage sensor-2 (кухня, тумба)/water_leak",
        "Leakage sensor-3 (кухня, посудомойка)/water_leak",
        "Leakage sensor-4 (душевая, поддон)/water_leak",
        "Leakage sensor-5 (детская, кондиционер)/water_leak",
        "Leakage sensor-6 (aux, кондиционер)/water_leak",
        "Leakage sensor-7 (спальня, кондиционер)/water_leak",
        "Leakage sensor-8 (БСУ, ниша)/water_leak",
        "Leakage sensor-9 (МСУ, пол)/water_leak",
        "Leakage sensor-10 (Daikin AC - Room4-MSU)/water_leak",
        "Leakage sensor-11 (МСУ, ниша)/water_leak",
        "wb-mwac_203/F1",
        "wb-mwac_203/F2",
        "wb-mwac_203/F3"
    ],
    then: function (newValue, devName, cellName) {
        log.warning("Leakage sensor event! DevName = {}, value = {}", devName, newValue);
        if (newValue == "true" || newValue == true) {

            dev["SoundAlarm_virt/triggeredByLeakage"] = true;
            dev["SoundAlarm_virt/isActive"] = true;

            if (devName === "wb-mwac_203") {
                SendTelegramMsg(1, "АВАРИЯ! Утечка - проводной датчик ВБ");
            } else {
                SendTelegramMsg(1, "АВАРИЯ! Утечка на устройстве {}", devName);
            }
        }
    }
});

defineRule("waterCutOff", {
    whenChanged: ["Leakage sensor-1 (стиральная машина)/water_leak", "Leakage sensor-2 (кухня, тумба)/water_leak",
        "Leakage sensor-3 (кухня, посудомойка)/water_leak", "Leakage sensor-8 (БСУ, ниша)/water_leak", "wb-mwac_203/F1",
        "Leakage sensor-9 (МСУ, пол)/water_leak", "Leakage sensor-11 (МСУ, ниша)/water_leak"],
    then: function (newValue, devName, cellName) {
        if (newValue == "true" || newValue == true) {
            if (dev["Smoke sensor (шкаф в прихожке)/smoke"] != "true") {
                dev["wb-mwac_203/K1"] = false;
                dev["wb-mwac_203/K2"] = false;
            }
        }
    }
});