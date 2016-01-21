Bands = new Mongo.Collection("bands"); // monitored rf bands
Config = new Mongo.Collection("config"); // configuration stuff
ActiveBands = new Mongo.Collection("active"); // track active bands stuff

// since Math.sign isn't part of full js spec yet...
var sign = function(x) {
  x = parseInt(x);
  return ((x === 0) ? x : ((x > 0) ? 1 : -1));
}

function flatten(arr) {
  return arr.reduce(function (flat, toFlatten) {
    return flat.concat(Array.isArray(toFlatten) ? flatten(toFlatten) : toFlatten);
  }, []);
}

if (Meteor.isClient) {

  BandData = new Mongo.Collection("band_data");

  $.fn.editable.defaults.mode = 'inline';

  Template.configOptions.helpers({
    config: function(){
      return Config.findOne();
    }
  });

  Template.configOptions.rendered = function(){
    // bind edit-in-place
    $('.spectrum-config .editable').editable({
      mode: 'popup',
      placement: 'right',
      success: function(response, newValue) {

        var id = $(this).attr('id').split("_")[0];
        var dest = $(this).attr('data-dest');

        var payload = {};
        payload[dest] = newValue;
        Config.update(id, {$set : payload });
      }
    });
  }

  // helper function to split Bands -> nx2 array.
  Template.spectrumContainer.helpers({
    spectrumRows: function(rowLength) {
      var bands = Bands.find({}).fetch();

      // this is looked for to see whether a "add new" pane should be added.
      bands.push({addNew: true});
      var rows = [];

      while (bands.length > rowLength) {
        rows.push({ spectrumRow: bands.slice(0, rowLength)});
        bands = bands.slice(rowLength);
      }

      rows.push({ spectrumRow: bands });
      return rows;
    }
  });

  // bind events for adding/removing panels
  Template.rfBand.events({
    'click .close': function(){
      console.log("closing..." + this._id);
      Bands.remove(this._id);
    },
    'click .newSpectrum': function(){
      console.log('adding new spectrum');
      var newBandID = Bands.insert({
        name: "New RF Band",
        lf: 1200,
        hf: 1210,
        lpow: -120,
        hpow: -50,
        ch: 0,
        data: {0: [[1,2]] },  // each subscan indexed here in the dict
        subscan: 1,
        scans: [],
        active: false
      });
    //  var ids = ActiveBands.findOne().band_ids;
    //  ids.push(newBandID);
    //  ActiveBands.update({$set: { band_ids: ids }});
    }
  });


  // when plot panel rendered, let flot do it's stuff!
  Template.rfBand.rendered = function(){
    var band = this.data;
    var plot = $.plot("#" + band._id + "_plot", [[[1,2]]], {
                        yaxis: {min: band.lpow, max: band.hpow},
                        xaxis: {min: band.lf, max: band.hf}
                    });

    // bind plot update for changes in scale/range
    Tracker.autorun(function(){
      var thisBand = Bands.findOne(band._id);

      plot.getAxes().yaxis.options.min = thisBand.lpow;
      plot.getAxes().yaxis.options.max = thisBand.hpow;
      plot.getAxes().xaxis.options.min = thisBand.lf;
      plot.getAxes().xaxis.options.max = thisBand.hf;
      console.log('start');
      console.log(thisBand);
      console.log(thisBand.data);
      var dd = [];
      if (thisBand.subscan == 1){
        dd = thisBand.data;
      } else {
        dd = [].concat.apply([], thisBand.data);
      }
      console.log([dd]);
      console.log("done");
      plot.setData([dd]);

      plot.setupGrid();
      plot.draw();

    })

    // bind edit-in-place
    $('.spectrum-plot .editable').editable({
      mode: 'popup',
      placement: 'right',
      success: function(response, newValue) {

        var id = $(this).attr('id').split("_")[0];
        var dest = $(this).attr('data-dest');

        var payload = {};
        payload[dest] = parseInt(newValue);
        Bands.update(id, {$set : payload });
      }
    });
  };
}

if (Meteor.isServer) {

  var SerialPort = Meteor.npmRequire('serialport');

  Meteor.startup(function(){
    // defaults
    if (Config.find().count() == 0){
      Config.insert({port: '/dev/tty.SLAB_USBtoUART', err: ''});
    } else {
      var e = Config.findOne();
      Config.update(e._id, {$set :{err: ''}});
    }

    if (ActiveBands.find().count == 0){
          ActiveBands.insert({active_id: null, band_ids: []});
    }
  })

  // wrapper for serial stuff
  var serialWrapper = function(){

    var self = this;

    this.serial = null; // public, in case need it for some reason externally
    var isConnected = false;  // flag to see what the serial connection status is.


    var config = {
      startFreq: null,
      stepSize: null,
      rbw: null
    };

    this.scanTracker = {
      scanList: [],
      scanIndex: null
    };

    this.updateScanList = function(){
      var l = [];
      Bands.find().forEach(function(e){
        l.push(e.scans);
      })

      scanTracker.scanList = flatten(l);
      scanTracker.scanIndex = 0;
      console.log(scanTracker.scanList);
    }

    var nextScan = function(){
      var scanTotal = scanTracker.scanList.length;
      var nextIndex = scanTracker.scanIndex++;
      if (nextIndex >= scanTotal){
        nextIndex = 0;
      }
      // update index
      scanTracker.scanIndex = nextIndex;

      self.serial.emit('scan');
    }

    // "keepalive" function; checks every 2 seconds to see if things are bad
    // or need updating.
    var retrySerial = Meteor.setInterval(function(){
      if (!isConnected){
        console.log("trying to reconnect...");
        connect(Config.findOne().port);
      }
    }, 2000);

    // custom parser for serial data from RF Explorer
    var rfParser = function(){
      var data = '';
      return function (emitter, buffer) {
        data += buffer.toString('hex');

        // Split collected data by delimiter
        var parts = data.split('0d0a');
        data = parts.pop();
        parts.forEach(function (part) {
          //console.log(part);
          var match = /^245370([a-f\d]{224,224})/.exec(part);
          var match2 = /^2343322d463a([a-f\d]{150,150})/.exec(part);
          if (match) {
            var b = new Buffer(match[1], 'hex');
            emitter.emit('data', b);
          } else if (match2) {
            //console.log(match2);
            //console.log(match2[1]);
            var b = new Buffer(match2[1], 'hex');
            // parse out relevant data...
            //b = Buffer.map(function(c){ return String.fromCharCode(c); })
            // pull out RBW substring; in kHz -> convert to MHz
            var rbw = parseInt(b.toString('ascii', 61, 66))/1000.0;

            // reported in kHz, convert to MHz
            var startFreq = parseInt(b.toString('ascii', 0, 7))/1000.0;

            // step size; reported back in Hz, so convert to MHz
            var stepSize = parseInt(b.toString('ascii', 8, 15))/1000000.0;

            // emit config dictionary;
            emitter.emit('config', {startFreq: startFreq, stepSize: stepSize, rbw: rbw});
          }
        });
      };
    };

    // takes frequency in kHz, powers in dBm, returns properly padded command string
    var formatCommand = function(lf, hf, lpow, hpow){
      var s;

      s = '0000000' + 1000.0*lf;
      var lowFreq = s.substr(s.length - 7);
      s = '0000000' + 1000.0*hf;
      var highFreq = s.substr(s.length - 7);

      s = '000' + Math.abs(lpow);
      console.log("lowpow: " + sign(lpow));
      console.log("hpow: " + sign(hpow));
      console.log(lpow);
      console.log(hpow);
      var lowPow = ((sign(lpow) === 1) ? '0' : '-') + s.substr(s.length - 3);

      s = '000' + Math.abs(hpow);
      var highPow = ((sign(hpow) === 1) ? '0' : '-') + s.substr(s.length - 3);

      return '#\x20C2-F:' + lowFreq + ',' + highFreq + ',' + lowPow + ',' + highPow;
      //return cmd;
    }

    // connect function
    var connect = function(port){

      self.serial = new SerialPort.SerialPort(port, {
        baudrate: 500000,
        parser: rfParser(),
        disconnectedCallback: Meteor.bindEnvironment(function(){
          console.log('disconnected!');

          // push error message to browser status console
          var o = Config.findOne();
          Config.update(o._id, {$set : {err: "RF Explorer serial connection disconnected."}});

          self.serial = null;
          isConnected = false;
        })
      }, false);

      // attach event listeners
      self.serial.on("open", Meteor.bindEnvironment(function(){
        console.log('open serial');
        isConnected = true;

        // update console log
        var o = Config.findOne();
        Config.update(o._id, {$set: { err: "Connected and working!"}});

        var e = Bands.findOne();
        //currentBand._id = e._id;
        var cmd = formatCommand(e.lf, e.hf, e.lpow, e.hpow);
        console.log(cmd);
        //cmd = '#\x20C2-F:' + e.lf*1000 + ',' + e.hf*1000 + ',-060,-120';
        // write config string; update this to something smarter?

        // wait, in case RF explorer is still powering up.
        Meteor.setTimeout(function(){
          updateScanList();
          self.serial.emit('scan');
          //self.serial.write('#\x20C2-F:1200000,1210000,-010,-100');
          //self.serial.write(cmd);
        }, 3000);

        // bind input data callback
        self.serial.on('data', Meteor.bindEnvironment(function(data){
          console.log("id: " + scanTracker.scanList[scanTracker.scanIndex].id);
          var e = Bands.findOne(scanTracker.scanList[scanTracker.scanIndex].id);
//          var e = Bands.find({_id: scanTracker.scanList[scanTracker.scanIndex].id}).fetch();

          var o = [];
          //var hf = parseFloat(e.hf);
          //var lf = parseFloat(e.lf);
          for (var i = 0; i < data.length; ++i){
            var pt = config.startFreq + i*config.stepSize;
            o.push([pt, parseInt(data[i])/(-2.0)]);
          }
            Bands.update(e._id, {$set: {data: o}});
          console.log(e.data);
          console.log('finished data');

          //var bids = [];
          //Bands.find().fetch().forEach(function(){
          //bids.push(this._id);
          //});
          //	updateBands(bids);
          //console.log(bids);
          //nextScan();

        }));

        self.serial.on('config', function(data){
          console.log(data);
          config = data;
          //console.log("test event");
        });

        self.serial.on('scan', function(){
          var s = scanTracker.scanList[scanTracker.scanIndex];
          var cmd = formatCommand(s.lf, s.hf, s.lpow, s.hpow);
          console.log('inside scan, sending: ' + cmd);
          self.serial.write(cmd);
        })
      }));



      // actually open the serial connection.
      self.serial.open(Meteor.bindEnvironment(function(err){
        if(err){
          var msg = "Trouble connecting to port " + port
          + ". Either enter the right port above, or reconnect the device. "
          + err;

          console.log(msg);
          var o = Config.findOne();
          Config.update(o._id, {$set: { err: msg}});
        }
      }));
    }; // end connect

    // refresh the serial connection
    this.reconnect = function(){
      rfExplorer.serial.close(function(err){
        isConnected = false;
      })
    }

    return this;
  }

  var rfExplorer = serialWrapper();

  Config.find().observeChanges({
    changed: function(id, fields){
      console.log(fields);
      if ('port' in fields){
        console.log('Serial port changed. Trying to reconnect.');
        rfExplorer.reconnect();
      }
    }
  });



  Bands.before.update(function(userId, doc, fieldNames, modifier, options){
    // check, don't need to do this if just updating the data...
    if (!('data' in modifier.$set)){
      var scan = [];
      //assuming updates...?
      //jQuery.extend(doc, modifier.$set);
      for (var k in modifier.$set){
        doc[k] = modifier.$set[k];
      }

      var delta = (doc.hf - doc.lf)/parseFloat(doc.subscan);
      var newLF = doc.lf;
      var newHF;
      for (var i = 0; i < doc.subscan; ++i){
        newHF = Math.round(newLF + delta);
        scan.push({lf: newLF, hf: newHF, lpow: doc.lpow, hpow: doc.hpow, id: doc._id, subscan: i});
        newLF = newHF;
      }
      modifier.$set.scans = scan;
      //console.log(modifier.$set);

    } /*else {
      //console.log('updating data');
      var subscan_index = rfExplorer.scanTracker.scanList[rfExplorer.scanTracker.scanIndex].subscan
      var inputData = modifier.$set['data'];
      modifier.$set['data'] = doc['data'];
      modifier.$set['data'].splice(subscan_index, 1, inputData);
      //console.log('scan index: ' + subscan_index);
      //console.log('input data: ' + inputData);

      //console.log(modifier);
    }*/
  });

  Bands.after.update(function(userId, doc, fieldNames, modifier, options){
    if (!('data' in modifier.$set)) rfExplorer.updateScanList();
  });
  Bands.after.insert(function(userId, doc, fieldNames, modifier, options){
    if (!('data' in modifier.$set)) rfExplorer.updateScanList();
  });

}
