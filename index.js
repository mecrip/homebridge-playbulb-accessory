"use strict";

var Noble = require('noble');
var Service, Characteristic;

var LIGHT_EFFECTS_TEMPLATE = "ff<rgb>04000000";
var RAINBOW_EFFECT="00ff00ff0300ff00";
var OFF_EFFECT="0000000001000000";

var DEFAULT_PLACEHOLDER = "<rgb>";
var DEFAULT_EFFECTS_HANDLE = 0x0017;
var DEFAULT_BATTERY_HANDLE = 0x0022;
var DEFAULT_COLOR = "ff9f40";

var FX_ID_OFF="ff";
var FX_ID_RAINBOW="03";
var FX_ID_LIGHT="04";

/* status report:

when off:f
position (8,2)=ff
hex.substring(8,10)==='ff'

when rainbow:
0000000003000000
hex.substring(8,10)==='03'

when candle:
0000000004000000
hex.substring(8,10)==='05'

*/


module.exports = function(homebridge) {
	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;

	homebridge.registerAccessory("homebridge-playbulb-accessory", "Playbulb", PlaybulbAccessory);
}

function PlaybulbAccessory(log, config) {
	this.log = log;
	this.name = config["name"]
	this.address = config["address"]

    this.effects_template = LIGHT_EFFECTS_TEMPLATE;
    this.placeholder = DEFAULT_PLACEHOLDER; 
    this.effects_handle = DEFAULT_EFFECTS_HANDLE;
    this.battery_handle = DEFAULT_BATTERY_HANDLE;
    
    var hex = DEFAULT_COLOR;
    var rgb = this._hexToRgb(hex);
    var hsv = this._rgbToHsv(rgb.R, rgb.G, rgb.B);
    
    this.hue = hsv.H;
    this.saturation = hsv.S;
    this.value = hsv.V;
    this.BatteryLevel=100;
    
    this.LampService=null;
    this.SwitchService=null;
    this.BatteryService=null;
    this.InfoService=null;
    this.updateService=null;
    
    this.bulb=null;
    
    //define and load the associated services
    this.LoadServices();
    
	/**
	 * Initialise the Noble service for talking to the bulb
	 **/
	Noble.on('stateChange', this.nobleStateChange.bind(this));

}

PlaybulbAccessory.prototype.LoadServices = function (){
    var service = new Service.Lightbulb(this.name,"Light");
    service.getCharacteristic(Characteristic.On).on('get', this.getPower.bind(this));
    service.getCharacteristic(Characteristic.On).on('set', this.setPower.bind(this));
    service.addCharacteristic(Characteristic.Brightness).on('get', this.getBrightness.bind(this));
    service.getCharacteristic(Characteristic.Brightness).on('set', this.setBrightness.bind(this));
    service.addCharacteristic(Characteristic.Hue).on('get', this.getHue.bind(this));
    service.getCharacteristic(Characteristic.Hue).on('set', this.setHue.bind(this));
    service.addCharacteristic(Characteristic.Saturation).on('get', this.getSaturation.bind(this));
    service.getCharacteristic(Characteristic.Saturation).on('set', this.setSaturation.bind(this));
    homebridgeAcc.addService(service);
    this.LampService= service;
    
    var batteryService= new Service.BatteryService(this.name,"Battery");
    batteryService.getCharacteristic(Characteristic.BatteryLevel).on('get', this.getBatteryLevel.bind(this));
    batteryService.getCharacteristic(Characteristic.ChargingState).on('get', (callback) => { callback(false,Characteristic.ChargingState.NOT_CHARGEABLE )} );
    batteryService.getCharacteristic(Characteristic.StatusLowBattery).on('get',(callback) => { 
        if(this.BatteryLevel<25)
            callback(false,Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
        else
            callback(false,Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
    });
    batteryService.setCharacteristic(Characteristic.Name, "Battery");
    homebridgeAcc.addService(batteryService);
    this.BatteryService=batteryService;
    
    var infservice = homebridgeAcc.getService(Service.AccessoryInformation);
    infservice.setCharacteristic(Characteristic.Manufacturer, "Mipow");
    infservice.setCharacteristic(Characteristic.Model, "Playbulb Candle");
    infservice.setCharacteristic(Characteristic.SerialNumber, this.address);
    this.InfoService=infservice;
    
    var switchService = new Service.Switch(this.name,"Rainbow");
    switchService.getCharacteristic(Characteristic.On).on('get', this.getRainbowOn.bind(this));
    switchService.getCharacteristic(Characteristic.On).on('set', this.setRainbowOn.bind(this));
    switchService.setCharacteristic(Characteristic.Name,"Rainbow Mode");
    homebridgeAcc.addService(switchService);
    this.SwitchService=switchService;
}

PlaybulbAccessory.prototype.getServices = function() {
	return [this.LampService, this.BatteryService, this.SwitchService,this.infoService];
}

/** 
* handling of interface calls 
**/

PlaybulbCandle.prototype.getBatteryLevel = function(callback){
    var self=this;
    this.bulb.readHandle(this.battery_handle, function(error,data)
     {
        if(error)
            callback(error,null);
        else{
            var i=data.toString("hex");
            self.BatteryLevel = parseInt(i.substring(0,2),16);
            self.log.info("Battery read: %s, %s, %d",error,i,self.BatteryLevel); 
            self.BatteryService.updateCharacteristic(Characteristic.StatusLowBattery,0);
            callback(false,self.BatteryLevel);
        }
    });
}

PlaybulbCandle.prototype.getRainbowOn = function(callback){
    this.getEffect(function(error,effect){
            var power=false;
        
            if (!error)
                 if(effect.substring(8,10)===FX_ID_RAINBOW)
                        power=true;
                            
            this.log.info("getRainbowOn: %s, %s ",effect,power);    
        
            callback(error, power);
        }.bind(this));
};

PlaybulbCandle.prototype.setRainbowOn = function(value, callback){
    if (value){
        this.LampService.updateCharacteristic(Characteristic.On,0);
        this.setEffect(RAINBOW_EFFECT,callback);
    }
    else
        this.setEffect(OFF_EFFECT,callback);
}

PlaybulbCandle.prototype.getPower = function(callback){
        this.getEffect(function(error,effect){
            var power=false;
            if (!error)
                 if(effect.substring(8,10)===FX_ID_LIGHT)
                        power=true;
            
             this.log.info("getPower: %s, %s ",effect,power); 
                            
            callback(error, power);
        }.bind(this));
};

PlaybulbCandle.prototype.setPower = function(value, callback){
   if (value){
        this.SwitchService.updateCharacteristic(Characteristic.On,0);
        
        var rgb = this._hsvToRgb(this.hue, this.saturation, this.value);
        hex = this._rgbToHex(rgb.R, rgb.G, rgb.B);
        
        this.setEffectColor(hex, callback);
   }
    else
        this.setEffect(OFF_EFFECT,callback);
};

PlaybulbCandle.prototype.getHue = function(callback){
    this.getEffectColor(function(error,color){
        if (!error){
            var rgb = this._hexToRgb(color);
            var hsv = this._rgbToHsv(rgb.R, rgb.G, rgb.B);
            //this.log.info("Hue is set to " + hsv.H);
        }
        callback(error, hsv.H);
    }.bind(this));
};

PlaybulbCandle.prototype.setHue = function(value, callback){
    var rgb = this._hsvToRgb(value, this.saturation, this.value);
    var hex = this._rgbToHex(rgb.R, rgb.G, rgb.B);
    this.setEffectColor(hex, function(error){
        if(!error){
            this.hue = value;
        }
        callback(error);
    }.bind(this));
};

PlaybulbCandle.prototype.getSaturation = function(callback){
    this.getEffectColor(function(error,color){
        if (!error){
            var rgb = this._hexToRgb(color);
            var hsv = this._rgbToHsv(rgb.R, rgb.G, rgb.B);
            //this.log.info("Saturation is set to " + hsv.S);
        }
        callback(error, hsv.S);
    }.bind(this));
};

PlaybulbCandle.prototype.setSaturation = function(value, callback){
    var rgb = this._hsvToRgb(this.hue, value, this.value);
    var hex = this._rgbToHex(rgb.R, rgb.G, rgb.B);
    this.setEffectColor(hex, function(error){
        if(!error){
            this.saturation = value;
        }
        callback(error);
    }.bind(this));
};

PlaybulbCandle.prototype.getBrightness = function(callback){
    this.getEffectColor(function(error,color){
        if (!error){
            var rgb = this._hexToRgb(color);
            var hsv = this._rgbToHsv(rgb.R, rgb.G, rgb.B);
            //this.log.info("Brightness is set to " + hsv.V);
        }
        callback(error, hsv.V);
    }.bind(this));
};

PlaybulbCandle.prototype.setBrightness = function(value, callback){
    var rgb = this._hsvToRgb(this.hue, this.saturation, value);
    var hex = this._rgbToHex(rgb.R, rgb.G, rgb.B);
    this.setEffectColor(hex, function(error){
        if(!error){
            this.value = value;
        }
        callback(error);
    }.bind(this));
};

PlaybulbCandle.prototype.setEffectColor = function(rgb, callback) {
    var effect=OFF_EFFECT;
    
    if(rgb.toString()!=='000000')
        effect= this.effects_template.replace(this.placeholder, rgb);
    
    this.setEffect(effect,callback);
};

PlaybulbCandle.prototype.getEffect = function(callback) {
    var sdata="";
    this.bulb.readHandle(this.effects_handle, function(error, data) {
        if(error)
            this.log.error("getEffect: Error while reading effects from address " + this.address + ": " + error);
        else {
            sdata=data.toString("hex");
            //this.log.info("getEffect: %s", sdata);
        }
        callback(error,sdata);
    }.bind(this));
};

PlaybulbCandle.prototype.setEffect = function(effect, callback) {
    this.log.info("setEffect: %s",effect);
    
    var buf = new Buffer(effect, "hex");
    this.bulb.writeHandle(this.effects_handle, buf, true, function(error){
        if(error){
            this.log.info("Error while setting value on addres " + this.address + ": " + error);
        }
        callback(error);
    }.bind(this));
};

PlaybulbCandle.prototype.effectToColor = function(effect) {
    var pos = this.effects_template.indexOf(this.placeholder);
    return effect.substring(pos,pos+6);
};

PlaybulbCandle.prototype.getEffectColor = function(callback) {
    
    this.getEffect(function(error,effect){
        if(!error){
            var sdata=effect.toString("hex");    
            var color = this.effectToColor(sdata);
            
            //this.log.info("getEffectColor: %s, %s", sdata,color);
        }
        callback(error,color);    
    }.bind(this));
};



/** 
* handling of RGB 
**/

PlaybulbCandle.prototype._hexToRgb = function(hex){
	var r = parseInt(hex.substring(0,2),16);
	var g = parseInt(hex.substring(2,4),16);
	var b = parseInt(hex.substring(4,6),16);
	return {R:r, G:g, B:b};
};

PlaybulbCandle.prototype._rgbToHex = function(r, g, b){
    var rt = (+r).toString(16);
    rt = rt.length === 1 ? '0' + rt : rt;
    var gt = (+g).toString(16);
    gt = gt.length === 1 ? '0' + gt : gt;
    var bt = (+b).toString(16);
    bt = bt.length === 1 ? '0' + bt : bt;
    var hex = rt + gt + bt;
    return hex;
};

PlaybulbCandle.prototype._hsvToRgb = function(h, s, v){
    var c = (v/100.0)*(s/100.0);
    var x = c *(1.0-Math.abs(((h/60.0)%2)-1));
    var m = (v/100.0) - c;
    var rt = c;
    var gt = 0.0;
    var bt = x;
    if(h >= 0.0 && h < 60.0){
        rt = c;
        gt = x;
        bt = 0.0;
    }else if(h >= 60.0 && h < 120.0){
        rt = x;
        gt = c;
        bt = 0.0;
    }else if(h >= 120.0 && h < 180.0){
        rt = 0.0;
        gt = c;
        bt = x;
    }else if(h >= 180.0 && h < 240.0){
        rt = 0.0;
        gt = x;
        bt = c;
    }else if(h >= 240.0 && h < 300.0){
        rt = x;
        gt = 0.0;
        bt = c;
    }
    var r = Math.round((rt+m)*255.0);
    var g = Math.round((gt+m)*255.0);
    var b = Math.round((bt+m)*255.0);
    return {R:r, G:g, B:b};
};

PlaybulbCandle.prototype._rgbToHsv = function(r, g, b){
	var rt = r/255.0;
	var gt = g/255.0;
	var bt = b/255.0;
	cmax = Math.max(rt, gt, bt);
	cmin = Math.min(rt, gt, bt);
	delta = cmax - cmin;
	var h = 0;
	if(delta !== 0){
		if(cmax === rt){
			h=60.0*(((gt-bt)/delta)%6);
		}else if(cmax === gt){
			h=60.0*(((bt-rt)/delta)+2);
		}else{
			h=60.0*(((rt-gt)/delta)+4);
		}
	}
	var s = 0;
	if(cmax !== 0){
		s=(delta/cmax)*100.0;
	}
	var v = cmax*100.0;
	return {H:h, S:s, V:v};
};


/**
 * Noble discovery callbacks
 **/
PlaybulbAccessory.prototype.nobleStateChange = function(state) {
	if (state == "poweredOn") {
		this.log.info("Starting Noble scan..");
		Noble.startScanning([DEFAULT_SERVICE], false);
		Noble.on("discover", this.nobleDiscovered.bind(this));
	} else {
		this.log.info("Noble state change to " + state + "; stopping scan.");
		Noble.stopScanning();
	}
}

PlaybulbAccessory.prototype.nobleDiscovered = function(accessory) {
	if (accessory.address == this.address) {
		this.log.info("Found accessory for " + this.name + ", connecting..");
		accessory.connect(function(error){
			this.nobleConnected(error, accessory);
		}.bind(this));
	} else {
		this.log.debug("Found non-matching accessory " + accessory.address);
	}
}

PlaybulbAccessory.prototype.nobleConnected = function(error, accessory) {
	if (error) return this.log.error("Noble connection failed: " + error);
	this.log.info("Connection success, discovering services..");
	Noble.stopScanning();
    
    this.bulb=accessory;
    
	accessory.on('disconnect', function(error) {
		this.nobleDisconnected(error, accessory);
	}.bind(this));
}

PlaybulbAccessory.prototype.nobleDisconnected = function(error, accessory) {
	this.log.info("Disconnected from " + accessory.address + ": " + (error ? error : "(No error)"));
	accessory.removeAllListeners('disconnect');
    
    this.bulb=null;
    
	this.log.info("Restarting Noble scan..");
	Noble.startScanning([], false);
}

