var express = require('express');
var Canvas = require('canvas');
var Image = Canvas.Image;
var app = express();
var moment = require('moment');
var fs = require('fs');
var util = require('util');
var mkdirp = require('mkdirp');
var getDirName = require('path').dirname;
var enableCache = false;
var cp = require('child_process').exec;
var bodyParser = require('body-parser');
var imgCache = {};

app.set('port', (process.env.PORT || 5000));

app.use('/public', express.static('public'));

app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

app.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'));
});

app.get('/regions', function(req, res) {

  try {
    var regions = fs.readdir('./regions/', function(err, files) {
      console.log(files)
      var results = [];
      for(var i in files) {
        if(/\.json$/i.test(files[i])) {
          var meta = './regions/'+files[i];
          console.log('read region meta :', meta);
          var region = JSON.parse(fs.readFileSync(meta));
          region.name = String(files[i]).replace(/\.json$/i,'');
          results.push(region);
        }
      }
      res.send(results);
    })

    // res.send(files)
  }catch(err) {
    console.log(err.stack);
  }

})

app.post('/bounds/:region', function(req, res) {
  var region = req.params.region;
  console.log(region,req.body)
  try {
    fs.writeFileSync('./regions/'+region+'.json', JSON.stringify(req.body));
  }catch(err) {
    console.log(err.stack);
  }
  res.sendStatus(200);
})

app.get('/bounds/:region', function(req, res) {

  var region = req.params.region;
  try {
    var data = fs.readFileSync('./regions/' + region + '.json');
    res.send(data);
  } catch(err) {
    console.log(err.stack);
  }

})

app.get('/reset-cache/:region', function(req,res) {

  var region = req.params.region;
  try {
    deleteFolderRecursive('./regions/'+region+'/debug/', function() {
      res.send(200)
    });
  } catch(err) {
    console.log(err.stack);
  }

})

app.get('/cache/:enable', function(req, res) {

  if(req.params.enable == '1') {
    enableCache = true;
  }
  else
    enableCache = false;
  res.send(200);

})

app.get('/lookup/:z/:x/:y', function(req, res) {
  var x = req.params.x,
      y = req.params.y,
      z = req.params.z;
  res.send(tileToLatLng(x,y,z));

});

app.get('/dummy-tiles/:region/:z/:x/:y', function (req, res) {
  var {x, y, z, region} = req.params;
  console.log('dummy tile: ', region, x, y, z);
  res.type('image/png').send(generateTile(x,y,z));
});

app.get('/tiles/debug/:region/:z/:x/:y/', handleTileRequestDebug);
app.get('/tiles/:region/:z/:x/:y/', handleTileRequest);

function handleTileRequestDebug(req, res) {
  req.params.debug = true;
  handleTileRequest(req,res);
}

function handleTileRequest(req, res) {
  var {x, y, z, region, debug} = req.params;
  console.log(`make tile: ${region}/${z}/${x}/${y}`);
  let tilePath = `./regions/${region}/${debug ? 'debug/' : ''}${z}/${x}${y}.png`;
  fs.exists(tilePath, (ext) => {

    if(ext) {
      console.log('found tile', tilePath);
      fs.readFile(tilePath, (err, data) => {
        res.type('image/png').send(data);
      });
    }
    else {
      createTileFromRawImage(region, x, y, z, debug, function(bytes) {
        console.log('send tile')
        res.type('image/png').send(bytes);
      });
    }
  });
}

app.get('/base/:z/:x/:y', function(req,res) {
  var request   = require('request');
  var x = req.params.x;
  var y = req.params.y;
  var z = req.params.z;
  var pipe      = req.pipe(request.post('http://mt1.google.com/vt/lyrs=m@110&hl=pl&x='+x+'&y='+y+'&z='+ z));
  var response  = [];

  pipe.on('data',function(chunk) {
    response.push(chunk);
  });

  pipe.on('end',function() {
    var res2 = Buffer.concat(response);
    res.send(res2);
  });
})

app.get('/exps/:id', function(req, res) {
  res.send(dummyExperience(req.params.id));
});

app.get('/pins', function(req, res) {
  res.send(regions.pins);
});

app.get('/pins/:id', function(req, res) {
  res.send(pins[req.params.id]);
});

function dummyExperience(id) {
  var type = Math.random() > 0.8 ? 'label' : 'link';
  if(type === 'link') {
    var expired = Math.random() > 0.6;
    var image = Math.floor((Math.random() - 0.01) * 4);

    return {
      exp_id :  'Experience #' + id,
      label : 'Experience #' + id,
      state : expired ? 'expired' : 'current',
      start : expired ? '2016/11/08 14:30:00' : moment(Date.now() - 3600000 * Math.random()*2).format('YYYY/MM/DD HH:mm:ss'),
      end : expired ? '2016/11/08 15:00:00' : moment(Date.now() + 3600000 * Math.random()*5).format('YYYY/MM/DD HH:mm:ss'),
      hero_photo : 'public/event-bg' + image + '.png',
      content : 'this is the text description',
      pin_id : null
    };
  }
  else {
    return {
      exp_id : 'Experience #' + id,
      label : 'Label only',
      content : 'this is the text description',
      pin_id : null
    };
  }
};

function tileToLatLng(x,y,z) {
  let result = { lat : tileToLat(y,z), lng : tileToLong(x,z) };;
  return result;
}

function tileToLong(x,z) { return (x/Math.pow(2,z)*360-180); }

function tileToLat(y,z) {
    var n = Math.PI-2*Math.PI*y/Math.pow(2,z);
    return (180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n))));
}

function createTileFromRawImage(region, x, y, z, debug, cb) {
  console.log('create tile :', region, x, y, z)
  console.log('debug=',debug)
  x = Math.floor(x);
  y = Math.floor(y);
  z = Math.floor(z);
  let bounds = fs.readFile(`./regions/${region}.json`, (err, data) => {

    let {bounds} = JSON.parse(data);
    let tileBounds = [
      tileToLatLng(x,y,z),
      tileToLatLng(x+1,y,z),
      tileToLatLng(x+1,y+1,z),
      tileToLatLng(x,y+1,z)
    ];
    if(imgCache[region]) {
      render(null, imgCache);
    }
    else {
      fs.readFile(`./region-raw-img/${region}.png`, render);
    }

    function render(err, data) {
      if(err)
        throw err;
      let img = new Image;
      img.src = data;
      console.log(data.length)
      console.log(img.width, 'x', img.height)
      console.log(util.inspect(img, false, null))
      console.log('mag bounds:',bounds);
      console.log('tile bounds:', tileBounds);
      let regionWidth = Math.abs(Math.abs(bounds[0].lng) - Math.abs(bounds[1].lng)),
          regionHeight = Math.abs(Math.abs(bounds[1].lat) - Math.abs(bounds[2].lat));
      console.log(`regionWidth=${regionWidth}, regionHeight=${regionHeight}`);
      let tileWidth = Math.abs(tileBounds[0].lng - tileBounds[1].lng) * img.width /regionWidth,
          tileHeight = Math.abs(tileBounds[1].lat - tileBounds[2].lat) * img.height /regionHeight;
      console.log(`tileWidth=${tileWidth}, tileHeight=${tileHeight}`);
      let tileImg = new Canvas(256, 256);
      let originX = (Math.abs(tileBounds[0].lng) - Math.abs(bounds[0].lng))/regionWidth * img.width;
      let originY = (Math.abs(tileBounds[0].lat) - Math.abs(bounds[0].lat))/regionHeight * img.height;
      let ctx = tileImg.getContext('2d');

      if( originX > img.width + tileWidth ||
          originY > img.height + tileHeight ||
          originY < -tileHeight -1 || originX < -tileWidth -1 ) {
        console.log('OUTBOUND')
        ctx.rect(0, 0, 256, 256);
        ctx.fillStyle = '#F0F0F0';
        ctx.fill();
        ctx.fillStyle = '#222';
        ctx.font = '16px Arial';
        ctx.fillText('OUT OF BOUND', 128, 128);
        var bytes = tileImg.toBuffer(undefined, 3, ctx.PNG_FILTER_NONE);
        cb([])
        return
      }
      else {

        console.log(`fill size (${tileWidth}, ${tileHeight})`);
        console.log(`project (${originX}, ${originY}, ${originX + tileWidth}, ${originY + tileHeight})`);
        ctx.drawImage(img, originX, originY, tileWidth, tileHeight, 0, 0, 256, 256);
        if(debug) {
          drawText(ctx,{region, x,y,z}, originX,originY,tileWidth, tileHeight, z);
        }
        ctx.strokeRect(0, 0, 256, 256);
        ctx.fillStyle = '#DDD';
      }

      var bytes = tileImg.toBuffer(undefined, 3, ctx.PNG_FILTER_NONE);
      console.log('size', bytes.length);
      var dir = `./regions/${region}/${debug ? 'debug/' : ''}${z}/${x}${y}.png`;
      mkdirp(getDirName(dir), function (err) {
        if (err)
          console.log(err);

        if(enableCache) {
          fs.writeFile(dir, bytes, function(err) {
            if(err)
            console.log(err)
            cb(bytes);
          });
        }
        else {
          cb(bytes);
        }

      });

    }

  });

}

function drawText(ctx,param, ox,oy, dx, dy, z) {
  var {region,x,y,z} = param;
  var info = `${region}: ${z}/${x}/${y}`;
  var coords = 'from (' + [Math.round(ox), Math.floor(oy)].join(', ') + ')';
  var coords2 = 'to (' + [Math.round(ox+dx), Math.floor(oy + dy)].join(', ') + ')';
  ctx.font = '16px Arial';
  ctx.fillStyle = '#333';
  ctx.fillText(info, 8, 24);
  ctx.fillText(coords, 8, 48);
  ctx.fillText(coords2, 8, 64);
  ctx.font = '64px Arial';
  ctx.fillText(z + 'x', 144, 255);
}

function generateTile(x,y,z) {

  var canvas = new Canvas(256, 256);
  var ctx = canvas.getContext('2d');

  var coords = '(' + [x, y].join(', ') + ')';
  ctx.rect(0, 0, 256, 256);
  ctx.fillStyle = '#F0F0F0';
  ctx.fill();
  ctx.fillStyle = '#333';
  ctx.font = '16px Arial';
  ctx.fillText(coords, 24, 64);
  ctx.strokeStyle = 'white';
  ctx.strokeRect(0, 0, 256, 256);
  ctx.fillStyle = '#DDD';
  ctx.font = '64px Arial';
  ctx.fillText(z + 'x', 64, 192);
  var bytes = canvas.toBuffer(undefined, 3, canvas.PNG_FILTER_NONE);
  return bytes;
}

var deleteFolderRecursive = function(path, cb) {
  if( fs.existsSync(path) ) {
    fs.readdirSync(path).forEach(function(file,index){
      var curPath = path + "/" + file;
      if(fs.lstatSync(curPath).isDirectory()) { // recurse
        deleteFolderRecursive(curPath);
      } else { // delete file
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(path);
  }
  cb()
};
