// -----------------------------------------------------------------------------
// definitions
// -----------------------------------------------------------------------------
var logPrefix = "Thermo: ";
var temprRangeMin = 1;
var temprRangeMax = 60;
var intervalMin = 1;
var intervalMax = 60;
var startDelay = 5;
//
// -----------------------------------------------------------------------------
// General definition for thermostat cells
// -----------------------------------------------------------------------------
var tsCells = {
    "autoMode": {
        type: "switch",
        value: false,
        order: 1,
        forceDefault: true
    },
    "curValue": {
        type: "value",
        value: -227,
        precision: 0.1,
        order: 2,
        forceDefault: true
    },
    "Setpoint": {
        type: "range",
        value: 25,
        min: 0,
        max: 100,
        order: 3,
        forceDefault: true
    },
    "setpointMax": {
        type: "value",
        value: 60,
        readonly: false,
        order: 4,
        forceDefault: true
    },
    "setpointMin": {
        type: "value",
        value: 15,
        readonly: false,
        order: 5,
        forceDefault: true
    },
    "outManual": {
        type: "range",
        value: 50,
        min: 0,
        max: 100,
        order: 6,
        forceDefault: true
    },
    "runInterval": {
        type: "range",
        value: 30,
        min: 10,
        max: 60,
        order: 7,
        forceDefault: true
    },
    "timerID": {
        type: "value",
        value: -227,
        order: 8,
        forceDefault: true
    },
    "timerID_tout": {
        type: "value",
        value: -227,
        order: 9,
        forceDefault: true
    },
};
//
// -----------------------------------------------------------------------------
// General definition for PID cells
// -----------------------------------------------------------------------------
var tsPidCells = {
    Gain: {
        type: "value",
        value: 30,
        readonly: false,
        order: 1,
    },
    Kint: {
        type: "value",
        value: 10,
        readonly: false,
        order: 2,
    },
    integralSum: {
        type: "value",
        value: -227,
        precision: 0.1,
        forceDefault: true,
        order: 3,
    },
    integralWithhold: {
        type: "value",
        value: 5,
        readonly: false,
        forceDefault: true,
        order: 4,
    },
    integralLimit: {
        type: "value",
        value: 70,
        readonly: false,
        order: 5,
    },
    deadBand: {
        type: "value",
        value: 0.2,
        precision: 0.1,
        readonly: false,
        forceDefault: true,
        order: 6,
    },
    output: {
        type: "range",
        value: 0,
        min: 0,
        max: 100,
        forceDefault: true,
        order: 7,
    },
    outputMax: {
        type: "value",
        value: 100,
        readonly: false,
        forceDefault: true,
        order: 8,
    },
    outputMin: {
        type: "value",
        value: 0,
        readonly: false,
        forceDefault: true,
        order: 9,
    },
    scanQnt: {
        type: "value",
        value: 0,
        forceDefault: true,
        order: 10,
    },
};
//
// -----------------------------------------------------------------------------
// Verification that the value is within the range
// -----------------------------------------------------------------------------
function rangeVerification(value, minRange, maxRange) {
    var res;
    res = (value >= minRange && value <= maxRange) ? true : false;
    return res;
}

//
// -----------------------------------------------------------------------------
// Updates virtual TS controls from the real sensors
// -----------------------------------------------------------------------------
defineRule('updateTemp', {
    whenChanged: ["Temperature sensor (переезжающий)/temperature", "Temperature sensor-2/temperature"],
    then: function (newValue, devName, cellName) {
        var isRangeOK = rangeVerification(newValue, temprRangeMin, temprRangeMax);
        var devTSname = "void";
        if (isRangeOK) { // new temperature values is within the range, let's process it
            var isDeviceFound = true;
            switch (devName) {
                case "Temperature sensor-2": // Living room
                    devTSname = "Thermostat_TS2";
                    break;
                case "Temperature sensor (переезжающий)": // DK room
                    devTSname = "Thermostat_TS3";
                    break;
                default:
                    devTSname = "void";
                    isDeviceFound = false;
                    log(logPrefix + "Unknown device {} in <updateTemp> rule", devName);
            }
            if (isDeviceFound) {
                if (dev[devTSname]["timerID"] > 0) { // already initialised
                    dev[devTSname]["curValue"] = newValue;
                    log(logPrefix + "{}: temperature has been updated", devTSname);
                    // TEMPORATY TS2 -> TS1 TO BE DELETED LATER
                    if (devTSname == "Thermostat_TS2") {
                        dev["Thermostat_TS1"]["curValue"] = newValue;
                    }
                    // end of block to be deleted
                } else {
                    log(logPrefix + "{}: Unable to update temperature. TS is not initialized yet", devTSname);
                }
            }
        } else { // !(isRangeOK)
            log(logPrefix + "temperature update skipped. value {} of {} is out of range", newValue, devName);
        }//if (isRangeOK)
    }
});
//
// -----------------------------------------------------------------------------
// Function creates virtual devices -TS-
// -----------------------------------------------------------------------------
function defineVirtualTS(nameTS, minSP, maxSP, srcDev, srcCntrl) {
    var tsCellsLocal = {};
    tsCellsLocal = tsCells;
    tsCellsLocal["Setpoint"]["min"] = minSP;
    tsCellsLocal["Setpoint"]["max"] = maxSP;
    tsCellsLocal["setpointMin"]["value"] = minSP;
    tsCellsLocal["setpointMax"]["value"] = maxSP;
    var currTemp = dev[srcDev][srcCntrl];
    if (rangeVerification(currTemp, temprRangeMin, temprRangeMax)) {
        tsCellsLocal["curValue"]["value"] = currTemp;
    } else {
        log.warning(logPrefix + "Unable to init Thermostat_{} with {} value", nameTS, currTemp);
    }
    //
    defineVirtualDevice("Thermostat_" + nameTS, {
        title: "Thermostat " + nameTS,
        cells: tsCellsLocal
    });
    log(logPrefix + "New device {} created", nameTS);
}

//
// -----------------------------------------------------------------------------
// Function creates virtual devices -PID-
// -----------------------------------------------------------------------------
function defineVirtualPID(nameTS, minOut, maxOut) {
    var tsCellsLocal = {};
    tsCellsLocal = tsPidCells;
    tsCellsLocal["output"]["min"] = minOut;
    tsCellsLocal["output"]["max"] = maxOut;
    tsCellsLocal["outputMin"]["value"] = minOut;
    tsCellsLocal["outputMax"]["value"] = maxOut;
    //
    defineVirtualDevice("PID_" + nameTS, {
        title: "PID " + nameTS,
        cells: tsCellsLocal
    });
    log(logPrefix + "New PID device {} created", nameTS);
}

//
// -----------------------------------------------------------------------------
// PID integral resetting upon switchig to Auto
// -----------------------------------------------------------------------------
function integralReset(nameTS) {
    var tsDevName = "Thermostat_" + nameTS;
    defineRule("integralRst_" + nameTS, {
        asSoonAs: function () {
            return dev[tsDevName]["autoMode"];
        },
        then: function () {
            dev["PID_" + nameTS]["integralSum"] = 0;
            log(logPrefix + "Integral of PID_{} has been reset", nameTS);
        }
    });
}

//
// -----------------------------------------------------------------------------
// *** MAIN TEMPERATURE CONTROL ALGORITHM ***
// -----------------------------------------------------------------------------
function temperatureControl(nameTS, controlOut) {
    //var namePrefix = "Thermostat_";
    //var namePrefixPID = "PID_";
    var TSname = "Thermostat_" + nameTS;
    var PIDname = "PID_" + nameTS;
    var runInterval = dev[TSname]["runInterval"];
    //
    if (runInterval >= intervalMin && runInterval <= intervalMax) { // interval 5-60 minitus
        var timerID = null;
        var timerID_tout = null;
        timerID = setInterval(function () {
            // vars ts
            var currSetpoint = dev[TSname]["Setpoint"]; //1
            var setpointMin = dev[TSname]["setpointMin"]; //2
            var setpointMax = dev[TSname]["setpointMax"]; //3
            var currValue = dev[TSname]["curValue"]; //4
            var isAuto = dev[TSname]["autoMode"]; //5
            // vars pid
            var Gain = dev[PIDname]["Gain"]; //1
            var Kint = dev[PIDname]["Kint"]; //2
            var intSumm = dev[PIDname]["integralSum"]; //3
            var deadBand = dev[PIDname]["deadBand"]; //4
            var PidOut = dev[PIDname]["output"]; //5
            var pidOutMin = dev[PIDname]["outputMin"]; //6
            var pidOutMax = dev[PIDname]["outputMax"]; // 7
            var integralWHoldPct = dev[PIDname]["integralWithhold"]; //8
            var integralWHoldAbs = (pidOutMax - pidOutMin) / 100 * integralWHoldPct; // 9
            var integralLimit = dev[PIDname]["integralLimit"]; // 10
            log(logPrefix + "{}:: 1){}   2){}   3){}   4){}   5){}", nameTS, currSetpoint, setpointMin, setpointMax, currValue, isAuto);
            log(logPrefix + "{}_PID:: 1){}   2){}   3){}   4){}   5){}   6){}   7){}   8){}   9){}   10){}", nameTS, Gain, Kint, intSumm, deadBand, PidOut, pidOutMin, pidOutMax, integralWHoldPct, integralWHoldAbs, integralLimit);
            // vars common
            var dutyCycle;
            //
            var ScanCnt = dev[PIDname]["scanQnt"];
            ScanCnt += 1;
            dev[PIDname]["scanQnt"] = ScanCnt;
            log(logPrefix + "{}: scan counter = {}", nameTS, ScanCnt);
            if (isAuto) {
                if (rangeVerification(currSetpoint, setpointMin, setpointMax)) {
                    if (rangeVerification(currValue, temprRangeMin, temprRangeMax)) {
                        var errDelta = currSetpoint - currValue;
                        if (Math.abs(errDelta) > deadBand) { // we're out the deadBand
                            if ((PidOut < (pidOutMax - integralWHoldAbs) && errDelta > 0) || (PidOut > (pidOutMin + integralWHoldAbs) && errDelta < 0)) {
                                intSumm += errDelta;
                                intSumm = Math.round(intSumm);
                                dev[PIDname]["integralSum"] = intSumm;
                            }
                            PidOut = errDelta * Gain + intSumm * runInterval / Kint;
                            PidOut = Math.round(PidOut);
                            PidOut = (PidOut > pidOutMax) ? pidOutMax : PidOut;
                            PidOut = (PidOut < pidOutMin) ? pidOutMin : PidOut;
                            dev[PIDname]["output"] = PidOut;
                        } else { // !(Math.abs(errDelta) > deadBand)
                            log(logPrefix + "{}: auto calculation skipped. errDelta = {}, abs = {}", nameTS, errDelta, Math.abs(errDelta));
                        }
                        dutyCycle = (runInterval / 100) * PidOut; // converting 0-100% of PidOut to a proper duty cycle in minutes
                        log(logPrefix + "{} is in auto. Out = {}, Prop = {}, Int = {}, DutyCycle = {}", nameTS, PidOut, errDelta * Gain, intSumm * runInterval / Kint, dutyCycle);
                    } else { // !rangeVerification (currValue)
                        log.error(logPrefix + "Unexpected current temperature {} for Thermostat_{}", currValue, nameTS);
                    }
                } else { // !rangeVerification (setpoint)
                    log.error(logPrefix + "Unexpected setpoint value {} for Thermostat_{}", currSetpoint, nameTS);
                    dev[TSname]["Setpoint"] = setpointMin;
                }
            } else { // !(isAuto)
                if (!(dev[TSname]["outManual"] >= 0 && dev[TSname]["outManual"] <= 100)) {
                    log(logPrefix + "{}: Unexpected value {} of outManual", nameTS, dev[TSname]["outManual"]);
                    dev[TSname]["outManual"] = 25; // Enforce 25% to manual out in case of unexpected value
                }
                dutyCycle = (runInterval / 100) * dev[TSname]["outManual"];
            } // <if-else (isAuto) completed>
            //
            dutyCycle = (dutyCycle < 3) ? 0 : dutyCycle;
            dutyCycle = (dutyCycle > (runInterval - 3)) ? runInterval : dutyCycle;
            log(logPrefix + "{}: calculeted DutyCycle = {}", nameTS, dutyCycle);
            // TRANSFERRING TO THE OUTPUT
            if (dutyCycle == 0 || dutyCycle == runInterval) {
                if (dutyCycle == 0) {
                    if (dev[controlOut] == true) { // output is already True (cooling)
                        log(logPrefix + "thermostat {} is already True (continious cooling)", nameTS);
                    } else {
                        dev[controlOut] = true; // cooling
                        log(logPrefix + "thermostat {} set to True (cooling cont.)", nameTS);
                    }
                } else { //!(dutyCycle == 0 )
                    if (dev[controlOut] == false) { // output is already false (heating)
                        log(logPrefix + "thermostat {} is already False (continious heating)", nameTS);
                    } else {
                        dev[controlOut] = false; // heating
                        log(logPrefix + "thermostat {} set to True (heating cont.)", nameTS);
                    }
                } // end of IF-ELSE (dutyCycle == 0 )
            } else { // !(dutyCycle == 0 || dutyCycle == runInterval)
                // sending dutyCycle to the output
                dev[controlOut] = false; // heating
                log(logPrefix + "thermostat {} set to False (heating)", nameTS);
                //..................................................
                // set timeout to change the output
                //..................................................
                timerID_tout = setTimeout(function () {
                    dev[controlOut] = true; // cooling
                    log(logPrefix + "thermostat {} set to True (cooling)", nameTS);
                    dev[TSname]["timerID_tout"] = -227; // (timer ID will be reset by JS engine. We take care of timerID_tout)
                }, dutyCycle * 60 * 1000);
                //..................................................
                dev[TSname]["timerID_tout"] = timerID_tout;
            } //< end of IF-ELSE (dutyCycle == 0 || dutyCycle == runInterval)>
        }, runInterval * 60 * 1000);
        dev[TSname]["timerID"] = timerID;
    } else { // !(runInterval >= intervalMin && runInterval <=intervalMax)
        log.error(logPrefix + "unexpected runInterval value {} for {}", runInterval, nameTS);
    }
}

// -----------------------------------------------------------------------------
// Changing of setInterval  period
// -----------------------------------------------------------------------------
function intervalChange(nameTS, controlOut) {
    var namePrefix = "Thermostat_";
    var rulePrefix = "settingsChange_";
    //
    var devRunInterval = namePrefix + nameTS + "/" + "runInterval";
    var devSetpoint = namePrefix + nameTS + "/" + "Setpoint";
    var devMode = namePrefix + nameTS + "/" + "autoMode";
    var devOutManual = namePrefix + nameTS + "/" + "outManual";
    //
    defineRule(rulePrefix + nameTS, {
        whenChanged: [devRunInterval, devSetpoint, devMode, devOutManual],
        then: function (newValue, devName, cellName) {
            log(logPrefix + "{}: control <{}> changed to {}", devName, cellName, newValue);
            if (cellName == "runInterval") {
                var timerID = dev[devName]["timerID"];
                var timerIDtout = dev[devName]["timerID_tout"];
                //--------------------
                // resetting of TimeOut
                if (timerIDtout > 0) {
                    clearTimeout(timerIDtout);
                    dev[devName]["timerID_tout"] = -227;
                    log(logPrefix + "{}: timeout ID-{} has been reset", devName, timerIDtout);
                } else {
                    log(logPrefix + "{}: skipping reset of Timeout (timeoutID is {})", devName, timerIDtout);
                }
                //--------------------
                // resetting of Interval
                if (timerID > 0) {
                    clearInterval(timerID);
                    dev[devName]["timerID"] = -227;
                    log(logPrefix + "{}: interval ID-{} has been reset", devName, timerID);
                } else {
                    log(logPrefix + "{}: skipping reset of Interval (timerID is {})", devName, timerID);
                }
                temperatureControl(nameTS, controlOut);
            } // if (cellName == "runInterval")
        }
    });
}

//
// -----------------------------------------------------------------------------
// Create virtual TS with certain parameters (nameTS, minSP, maxSP)
// -----------------------------------------------------------------------------
defineVirtualTS("TS1", 10, 65, "Temperature sensor-2", "temperature"); 	// 01 bedroom
defineVirtualTS("TS2", 15, 70, "Temperature sensor-2", "temperature");  // 02 living room
defineVirtualTS("TS3", 20, 60, "Temperature sensor (переезжающий)", "temperature"); // 03 DK room
//
// -----------------------------------------------------------------------------
// Create virtual PID with certain parameters (nameTS, minOut, maxOut)
// -----------------------------------------------------------------------------
defineVirtualPID("TS1", 0, 100);
defineVirtualPID("TS2", 0, 100);
defineVirtualPID("TS3", 0, 100);
//
// -----------------------------------------------------------------------------
// Start of temperature control (wiht an initialisaton delay)
// -----------------------------------------------------------------------------
setTimeout(function () {
    temperatureControl("TS1", "wb-gpio/EXT3_K8")
}, startDelay * 1000);
setTimeout(function () {
    temperatureControl("TS2", "wb-gpio/EXT3_K7")
}, startDelay * 1000);
setTimeout(function () {
    temperatureControl("TS3", "wb-gpio/EXT3_K6")
}, startDelay * 1000);
//
// -----------------------------------------------------------------------------
// Start of monitoring for the autoMode change
// -----------------------------------------------------------------------------
integralReset("TS1");
integralReset("TS2");
integralReset("TS3");
//
// -----------------------------------------------------------------------------
// Start of monitoring for the range change
// -----------------------------------------------------------------------------
intervalChange("TS1", "wb-gpio/EXT3_K8");
intervalChange("TS2", "wb-gpio/EXT3_K7");
intervalChange("TS3", "wb-gpio/EXT3_K6");

// -----------------------------------------------------------------------------
// 								END OF SCRIPT
// -----------------------------------------------------------------------------