const express = require("express");
const socketClient = require("socket.io-client");
const mongoose = require('mongoose');
const prompt = require('prompt-sync')();

mongoose.connect("mongodb://localhost:27017/bankDB3",{useNewUrlParser:true ,useUnifiedTopology:true});

const accountSchema = {
  _id:Number,
  pin: Number,
  name:String,
  balance: Number
}

const Account = mongoose.model("account",accountSchema);

const Emitter = require('events');
const eventEmitter = new Emitter();
 
const totalServers = 3;
const selfServerId = 3;

var item_id = "";
var item_quantity = "";

var insideCriticalSection = 0;
var wantToEnterCriticalSection = 0;
var myTimeStamp = 0;

var queue = [];

const app = express();
app.use(express.urlencoded({extended:true}))
app.use(express.json());
app.set('eventEmitter',eventEmitter);

var replyCount = 0;

const http = require('http').createServer(app)
const io = require('socket.io')(http, {
  cors: {
    origin: '*',
  }
})

const server1 = socketClient("http://localhost:3000");
server1.emit("join",selfServerId);
const server2 = socketClient("http://localhost:4000");
server2.emit("join",selfServerId);


eventEmitter.on("acquire critical section",() => {
  wantToEnterCriticalSection = 0;
  insideCriticalSection = 1;

  console.log("processing....")

  setTimeout(() => {
    var mealId = parseInt(item_id);
    var orderQuantity = parseInt(item_quantity);

    Account.findOne({_id:mealId},(err1,result1) => {
      if(err1)
      {
        console.log("some error occured 1")
      }
      else
      {
        if(result1.balance>=orderQuantity)
        {
          Account.updateOne({_id:mealId},{balance:result1.balance-orderQuantity},(err2,result2)=>
          {
            const quant = result1.balance-orderQuantity;
            if(err2)
            {
              console.log("some error occured 2");
            }
            else
            {
              console.log("withdrawal successfull!");
              eventEmitter.emit("print-database");
              for(var i=1;i<=totalServers;i++)
              {
                if(i!=selfServerId)
                {
                  const data = {
                    accountID:mealId,
                    balance:quant
                  }
                  io.to(i).emit("update-database",data);
                }
              }
            }
          }) 
        }
        else
        {
          console.log("order quantity beyond capacity");
        }
      }
    })

    insideCriticalSection = 0;
    replyCount = 0;
    for(var i=0;i<queue.length;i++)
    {
      io.to(queue[i]).emit("reply",selfServerId);
    }
  }, 15000);
 
})

eventEmitter.on("send reply",(req) => {
  if(wantToEnterCriticalSection===0 && insideCriticalSection===0)
  {
    io.to(req.serverId).emit("reply",selfServerId);
  }
  else
  {
    if(myTimeStamp > req.timeStamp)
    {
      io.to(req.serverId).emit("reply",selfServerId);
    }
    else
    {
      queue.push(req.serverId);
    }
  }
})

eventEmitter.on("update-database-info",(data) => {
  Account.updateOne({_id:data.accountID},{balance:data.balance},(err,result)=>{
    if(err){
      console.log("error");
    }else{
      eventEmitter.emit("print-database");
    }
  })
})

eventEmitter.on("print-database",()=>{
  console.log("-----------------------------------------------------------------")
  console.log("available balance")
  Account.find({},(err,result) => {
    if(err){
      console.log("error")
    }else{
      console.log("Account ID : "+result[0]._id+"\nAvailable balance: "+result[0].balance);
      console.log("-----------------------------------------------------------------")
    }
  })
})

server1.on("update-database",(data)=>{
  eventEmitter.emit("update-database-info",data);
})

server2.on("update-database",(data)=>{
  eventEmitter.emit("update-database-info",data);
})


server1.on("reply",(serverId)=>{
  replyCount = replyCount + 1;
  if(replyCount===totalServers-1)
  {
    eventEmitter.emit("acquire critical section");
  }
})

server2.on("reply",(serverId)=>{
  replyCount = replyCount + 1;
  if(replyCount===totalServers-1)
  {
    eventEmitter.emit("acquire critical section");
  }
})




server1.on("request",(req)=>{
  eventEmitter.emit("send reply",req);
})

server2.on("request",(req)=>{
  eventEmitter.emit("send reply",req);
})



io.on('connection', socket => {
  socket.on('join', ( serverId ) => {
    socket.join(serverId);
    console.log('new socket connection with server ',serverId);
  })
});

function helper(meal_id,meal_quantity)
{
  eventEmitter.emit("print-database");
  item_id = meal_id;
  item_quantity = meal_quantity;
  wantToEnterCriticalSection = 1;
  for(var i=1;i<=totalServers;i++)
  {
    if(i!=selfServerId)
    {
      var date = new Date();
      var data = {
        timeStamp:date,
        serverId:selfServerId
      }
      io.to(i).emit("request",data);
    }
  }
}

app.get("/accountInfo",(req,res) => {
  Account.find({},(err,result)=>{
    if(err){
      res.send({
        success:false,
        message:"some error occured 3"
      })
    }else{
      res.send(result);
    }
  })
})

app.post("/withdraw",(req,res) => {
  const meal_id = parseInt(req.body.accountID);
  const meal_quantity = parseInt(req.body.amount);
  helper(meal_id,meal_quantity);
  res.send({
    success:true,
    message:"Amount withdrawn"
  })
})

http.listen(5000, function() {
  console.log('Bank App Server ',selfServerId,' Listening On Port 5000');
});

