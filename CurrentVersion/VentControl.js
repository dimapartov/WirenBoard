var pressTime;
var releaseTime;

defineRule("turnVentOnSinglePress", {
    whenChanged: "wb-gpio/EXT2_IN7",
    then: function (newValue, devName, cellName) {
        if (newValue) {
            pressTime = Date.now();
        } else {
            releaseTime = Date.now();
            
            // Если разница меньше или равна секунде, считаем коротким нажатием
            if ((releaseTime - pressTime) <= 1000) {
                dev["wb-mr6c_209/K5"] = !dev["wb-mr6c_209/K5"]
            } else if ((releaseTime - pressTime) >= 1000) {
                // Действие по длинному нажатию
            }
        }
    }
});
