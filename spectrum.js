Bands = new Mongo.Collection("bands"); // monitored rf bands
Config = new Mongo.Collection("config"); // configuration stuff


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
      Bands.insert({
        name: "New RF Band",
        lf: 1200,
        hf: 1210,
        lpow: -120,
        hpow: -50,
        ch: 0,
        data: [[1,2]],
        subscan: 1,
        scans: [],
        active: false
      });
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

      //console.log(thisBand.data);
      plot.setData([thisBand.data]);
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
        payload[dest] = newValue;
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
  })

  // wrapper for serial stuff
  var serialWrapper = function(){

    var self = this;

    this.serial = null; // public, in case need it for some reason externally
    var isConnected = false;  // flag to see what the serial connection status is.

    //var currentBand = null; // id of band being read out
    var currentBand = {
      _id: null,
      scans: [] // scans -> array of {lf, hf, lpow, hpow}
    };

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
          var match = /^245370([a-f\d]{224,224})/.exec(part);
          if (match) {
            var b = new Buffer(match[1], 'hex');
            emitter.emit('data', b);
          }
        });
      };
    };

    // takes frequency in kHz, returns properly padded string (7 chars)
    var formatFrequency = function(freq){
      var s = '0000000' + 1000.0*freq;
      return s.substr(s.length - 7);
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

          //var e = Bands.findOne();
          //cmd = '#\x20C2-F:' + e.lf*1000 + ',' + e.hf*1000 + ',-010,-100';
          // write config string; update this to something smarter?

          // wait, in case RF explorer is still powering up.
          Meteor.setTimeout(function(){
            self.serial.emit('scan');
            //self.serial.write('#\x20C2-F:1200000,1210000,-010,-100');
            //self.serial.write(cmd);
          }, 3000);

          // bind input data callback
          self.serial.on('data', Meteor.bindEnvironment(function(data){
            var e = Bands.findOne();

            var o = [];
            for (var i = 0; i < data.length; ++i){
              var pt = (e.hf - e.lf)*i/112.0 + e.lf;
              o.push([pt, parseInt(data[i])/(-2.0)]);
            }
            Bands.update(e._id, {$set: {data: o}});
          }));

          self.serial.on('scan', function(){
            //console.log("test event");
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
          scan.push({lf: newLF, hf: newHF, lpow: doc.lpow, hpow: doc.hpow});
          newLF = newHF;
      }
      modifier.$set.scans = scan;
      console.log(modifier.$set);
    }
  });
}
