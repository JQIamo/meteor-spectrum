Bands = new Mongo.Collection("bands"); // monitored rf bands

if (Meteor.isClient) {
 
 
 $.fn.editable.defaults.mode = 'inline';
 
  Template.spectrumContainer.helpers({
    spectrumRows: function(rowLength) {
      var bands = Bands.find({}).fetch();
      var rows = [];
      while (bands.length > rowLength) {
        rows.push({ spectrumRow: bands.slice(0, rowLength)});
        bands = bands.slice(rowLength);
      }
      
      // push on remaining rfBands
      rows.push({ spectrumRow: bands });
      return rows;
      
    }
  });


  Template.rfBand.rendered = function(){
    //var data = Template.instance().data;
   // console.log(this);
    var band = this.data;
    this.plot = $.plot("#" + band._id + "_plot", [[[1,2]]], {
                        yaxis: {min: band.lpow, max: band.hpow}, 
                        xaxis: {min: band.lf, max: band.hf}
                    });
  
  
  $('.editable').editable({
  mode: 'popup',
  placement: 'right',
  success: function(response, newValue) {
     console.log($(this).attr('id'));
     var id = $(this).attr('id').split("_")[0];
     Bands.update(id, {$set : { name: newValue} });
     
  }});
  };



}

if (Meteor.isServer) {
  Meteor.startup(function () {
    // populate with junk data;
    if (Bands.find({}).count() < 5) {
        Bands.insert({name: "RF Band 1", lf: 1200, hf: 1210, lpow: -120, hpow: -50, ch: 0});
        Bands.insert({name: "RF Band 1", lf: 1200, hf: 1210, lpow: -120, hpow: -50, ch: 0});
    }
  });
}
