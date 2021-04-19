// on delete don't stop

const express = require("express");
const { spawn } = require("child_process");
const { readdir, unlink } = require("fs");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const NodeMediaServer = require("node-media-server");
const nms = new NodeMediaServer({
  rtmp: {
    port: 1935,
    chunk_size: 1000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60
  },
  http: {
    port: 8000,
    allow_origin: "*"
  }
});
let isStreaming = false;
let connectedUsers = 0;
let currentChild;
const queue = [];
let i = -1;
const [username, password] = ["admin", "123"];

app.use("/", express.static("static"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(require("express-fileupload")({ createParentPath: true }));
app.use(require("cors")());

io.on("connection", socket => {
  connectedUsers++;
  io.sockets.emit("users", connectedUsers);
  socket.on("disconnect", () => {
    connectedUsers--;
    io.sockets.emit("users", connectedUsers);
  });
});

function circle(action) {
  currentChild?.stdin.pause()
  currentChild?.kill('SIGKILL');
  if (!queue[0]) return;

  const track = action ? queue[i] : (queue[i + 1] ? queue[++i] : queue[i = 0]); // ternary condition
  isStreaming = true;

  const child = spawn("ffmpeg", [ // ffmpeg -re -i x.mp3 -c copy -f flv rtmp://localhost/live/stream
    "-re",
    "-i", `queue/${track}`,
    "-c", "copy",
    "-f", "flv",
    "rtmp://localhost/live/stream"
	//https://mosaab-khalid-ksu-radio/live/stream.flv
	// was local host .
  ]);
  currentChild = child;
  
  console.log("Now playing", track);

  child.on("error", console.log);
  child.on("close", k=> {
    if (typeof k === "object") return;
    circle(false);
    isStreaming = false;
  });
}

readdir("./queue", (error, files) => {
  if (error) throw error;

    files.filter(file => ["mp3", "flv"].includes(file.split(".").pop())).forEach(file => queue.push(file));
    console.log("Current tracks queue", queue);
    circle();
});

app.post("/previous", (request, response) => {
  if (!request.headers.authorization || request.headers.authorization !== `${username}-${password}`) return response.sendStatus(401);

  queue[i - 1] ? queue[--i] : queue[i = queue.length - 1];
  console.log(i);
  console.log(queue[i-1]);
  console.log(queue[i]);
  circle(true);
  response.status(200).send("done!");
});

app.post("/next", (request, response) => {
  if (!request.headers.authorization || request.headers.authorization !== `${username}-${password}`) return response.sendStatus(401);

  queue[i + 1] ? queue[i ++] : queue[i = 0];
  console.log(i);
  console.log(queue[i]);
  circle(true);
  response.status(200).send("done!");
});

app.get("/current_track", (request, response) => {
  if (!request.headers.authorization || request.headers.authorization !== `${username}-${password}`) return response.sendStatus(401);

  response.status(200).send(queue[i]);
});

app.post("/check_login", (request, response) => {
  const { username: frontUsername, password: frontPassword } = request.body;
  
  if (username !== frontUsername || password !== frontPassword) return response.status(401).send("wrong username or password");

  response.sendStatus(200);
});

app.get("/tracks", (request, response) => {
  if (!request.headers.authorization || request.headers.authorization !== `${username}-${password}`) return response.sendStatus(401);
  console.log('RESSSPOONNNSSSEEEEE ' + queue);
  response.status(200).send(queue);
});


app.post("/upload", (request, response) => {
  if (!request.files || !request.files.track) return response.status(400).send("missing the mp3/flv track!");
  
  if (request.files.track.name.split(".").pop() === "flv") {
    request.files.track.mv(`./queue/${request.files.track.name}`, error => {
      if (error) throw error;
      
      queue.push(request.files.track.name);
      response.status(200).send("uploaded!");
      if (!isStreaming) circle();
    });
  } else if (request.files.track.name.split(".").pop() === "mp3") {
    request.files.track.mv(`./tmp/${request.files.track.name}`, error => {
      if (error) throw error;
      isLoading = true;
      const child = spawn("ffmpeg", [
        "-y",
        "-i", `tmp/${request.files.track.name}`,
        "-f", "flv",
        "-acodec", "libmp3lame",
        "-ab", "160k",
        "-ac", "1",
        `queue/${request.files.track.name.substring(0, request.files.track.name.length - ".mp3".length)}.flv`
      ]);
      
      child.once("exit", () => {
        queue.push(`${request.files.track.name.substring(0, request.files.track.name.length - ".mp3".length)}.flv`);
        if (!isStreaming) circle();
        console.log('YOU CAN DELETE NOW!');
        response.status(200).send("uploaded!");
      });
    });
  }
});

// delete the selected track
app.get('/delete', async (req, res) => {
  // turn off the file.
  circle(false);
  unlink('./queue/' + req.query.file.slice(0, -1), (err) => {
    if (err) {
      circle(true);
      throw err;
    }
    
    console.log("File is deleted.");
    // delete file from queue
    queue.forEach((track, i) => {
      if (req.query.file.slice(0, -1) === track){
        queue.splice(i, 1)
      }
    })
  });
  await res.sendStatus(200)
})


nms.run();
http.listen(80);
