Bands = new Mongo.Collection("bands"); // monitored rf bands

if (Meteor.isClient) {


  $.fn.editable.defaults.mode = 'inline';

  Template.spectrumContainer.helpers({
    spectrumRows: function(rowLength) {
      var bands = Bands.find({}).fetch();
      bands.push({addNew: true});
      var rows = [];
    //  Session.set('modRows', bands.length % rowLength);
      //console.log(Session.get('modRows'));
      while (bands.length > rowLength) {
        rows.push({ spectrumRow: bands.slice(0, rowLength)});
        bands = bands.slice(rowLength);
      }

      rows.push({ spectrumRow: bands });
      return rows;
    },

  });

/*  Template.spectrumRow.helpers({
    modRows: function(){
      return Session.get('modRows') == 0 ? true : false;
    }
  })*/




  Template.rfBand.events({
    'click .close': function(){
      console.log("closing..." + this._id);
      Bands.remove(this._id);
    },
    'click .newSpectrum': function(){
      console.log('adding new spectrum');
      Bands.insert({name: "New RF Band", lf: 1200, hf: 1210, lpow: -120, hpow: -50, ch: 0, data: [[1,2]]});
    }
  });

  Template.rfBand.rendered = function(){

    var band = this.data;
    //this.plot =
    var plot = $.plot("#" + band._id + "_plot", [[[1,2]]], {
                        yaxis: {min: band.lpow, max: band.hpow},
                        xaxis: {min: band.lf, max: band.hf}
                    });


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

    $('.editable').editable({
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
  Meteor.startup(function () {
    // populate with junk data;

  /*  if (Bands.find({}).count() < 5) {
        Bands.insert({name: "RF Band 1", lf: 1200, hf: 1210, lpow: -120, hpow: -50, ch: 0, data: [[1,2]]});
        Bands.insert({name: "RF Band 1", lf: 1200, hf: 1210, lpow: -120, hpow: -50, ch: 0, data: [[1,2]]});
    }*/
  });

  Meteor.setInterval(function(){
    Bands.find().fetch().forEach(function(e){
      var newData = [];
      var xdelta = parseFloat(e.hf) - parseFloat(e.lf);
      var ydelta = parseFloat(e.hpow) - parseFloat(e.lpow);

      for (var i = 0; i < 10; ++i){
        newData.push([parseFloat(e.lf) + xdelta *i/10.0, parseFloat(e.lpow) + ydelta*Math.random()]);
      }

      Bands.update(e._id, {$set: {data: newData}});
    });
  }, 1000);
}
