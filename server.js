const express = require('express')
const app = express()
const http = require('http').Server(app)

const log4js = require('log4js'); // 追加
const logger = log4js.getLogger(); // 追加
logger.level = 'info'; // 追加

//以下クロスドメイン許可
const io = require('socket.io')(http ,{
    cors: {
        origin: '*',
      }
})

let socketUserIdMap = new Map();
let socketNotificatoinUserIdMap = new Map();

//mysql接続*****************************
const mysql = require('mysql');
const { normalize } = require('path');

const con = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'password',
  database: 'talkserver' 
});

con.connect(function(err) {
	if (err) throw err;
	console.log('mysql Connected');
});
// ************************************

//試験的なapi通信**************************
app.get('/api/hello', (req, res) => {
    //クロスドメイン対応
    res.setHeader('Access-Control-Allow-Origin', '*') 
    res.send('hello i am express')
})

//App.vueメッセージ状態リストも出力する
app.get('/api/matchlist', (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*')
     
    console.log("api/matchlist")
    console.log(request.query.userId)

    if(request.query.userId){

        const sql = `select *, 1 as read_flg from t_matches where fromId = '${request.query.userId}'`
        con.query(sql, function (err, result) {  
            if (err) throw err;
            // console.log(result)
            // response.send(result)
            let matcheslist = result

            let roomList = []
            matcheslist.forEach((element)=>{
                roomList.push(element.roomId)
            })
            
            console.log(matcheslist)
            console.log(roomList)
            console.log("ここまで")

            const sql2 = `select roomId from t_messages where roomId in ( ${roomList.join(',')}) and fromId <> '${request.query.userId}' and read_flg = 0 group by roomId`
            con.query(sql2, function (err2, result2,) {  
                console.log("ここから")
                console.log(request.query.userId)
                if (err2) throw err2;
                console.log("ここから2")
                console.log(result2)
                console.log("ここから3")

                matcheslist.forEach((element)=>{

                    result2.forEach((element2)=>{
                        if(element.roomId == element2.roomId){
                            element.read_flg = 0
                        }
                    })
                })

                console.log(matcheslist)
                response.send(matcheslist)
            });

        });

    }else{
        response.send([])
    }

    
});
//**************************************************


//メッセージ送信画面で過去のメッセージを取得するためのAPI
app.get('/api/messages', (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*')
     
    console.log("api/messages")
    // console.log("api/messages roomId:" + request.query.roomId)
    // console.log("api/messages toId:" + request.query.toId)

	const sql = `select type, fromId as user ,message, DATE_FORMAT(created_time, '%Y/%c/%e %H:%i') as created_time from t_messages where roomId = ${request.query.roomId}`
	con.query(sql, function (err, result,) {  
        if (err) throw err;
        // console.log('before update')
        // console.log(request.query.roomId)
        // console.log(request.query.toId)
        const sql2 = `update t_messages set read_flg = 1 where roomId = ${request.query.roomId} and fromId = '${request.query.toId}' and read_flg = 0`
        con.query(sql2, function (err2, result2,) { 
            // console.log('after update')
            if (err2) throw err;
             console.log(result2)
             response.send(result)
        });
	});
});
//******************************************************



//WebSocketの処理***************************************


//Notification用
let notification = io.of('/notification').on('connection', (socket)=>{
    
    console.log('notification someone connected')

    //メッセージ画面を開いたときに、呼ばれてルームID、FROMID,TOIDを保持する
    socket.on('join',(data)=> {
        console.log('join userId:' + data.userId)
        
        if(data.userId != null){
            socket.userId = data.userId
            //ソケットIDとFromID（本人）を紐づける
            socketNotificatoinUserIdMap.set(socket.id, data.userId)
        }
        console.log(socketNotificatoinUserIdMap)
    
    })

    //メッセージ受信
    socket.on('message', (msg) => {
        console.log('notification message:' + msg)
    });
        

    //接続解除時に呼ばれる
    socket.on('disconnect', () => {
        // socket.rooms.size === 0
        // console.log('socketId')
        // console.log(socket.id)
        // console.log("before")
        // console.log(socketUserIdMap)
        console.log('notification disconnect')

        //退出する際にソケットIDと本人（FromID）の紐づけを解除
        socketNotificatoinUserIdMap.delete(socket.id)
        console.log(socketNotificatoinUserIdMap)

        // console.log("after")
        // console.log(socketUserIdMap)

    });
})

//メッセージ用
// io.on('connection',(socket)=>{
let chat = io.of('/chat').on('connection', (socket)=>{

    //websocket接続完了
    console.log('chat someone connected')

    //DBにメッセージを追加、メッセージの通知、Notificationの通知を行う
    let funcSendMesage = (type, msg)=>{

        //ルームに自分以外(相手)がいるか確認
        let isExists = false
        //io.sockets.rooms.get(socket.roomId).forEach( function (value){
        chat.adapter.rooms.get(socket.roomId).forEach( function (value){
            if(socketUserIdMap.get(value) == socket.toId){
                console.log('自分意外のユーザがいる')
                console.log(value)
                isExists = true
            }
        });

        //t_messagesにメッセージを登録、その際にルームに相手がいる場合は読んだものとして、read_flgを1とする
        let now = new Date().toLocaleString({ timeZone: 'Asia/Tokyo' }, { hour12: false })
        let sql = `INSERT INTO t_messages(type,roomId,fromId,message, created_time ,read_flg) VALUES('${type}', ${socket.roomId} ,'${socket.userId}','${msg}','${now}', ${isExists})`
        con.query(sql,function(err, result){
            if (err) throw err;
            console.log(result)
        })

        //websocektメッセージ用に日時をフォーマット変更(Myslq出力分と形式を統一するため)
        let now_for_scroipt = new Date(now)
        let today = now_for_scroipt.getFullYear() + "/" +  (now_for_scroipt.getMonth() + 1) + "/"+ now_for_scroipt.getDate() + ' ' + now_for_scroipt.getHours() + ":" + now_for_scroipt.getMinutes()

        //ルームを指定することでルーム外のクライアントにはメッセージが飛ばない
        //io.to(socket.roomId).emit('message',{user:socket.userId, message:msg, created_time:today})
        chat.to(socket.roomId).emit('message',{ type:type, user:socket.userId, message:msg, created_time:today})

        if(!isExists){
            console.log('来てる？')
            socketNotificatoinUserIdMap.forEach(function(value, key){
                
                if(value == socket.toId){
                    console.log(('来てる？ emit前'))
                    console.log("[" + key + ", " + value + "]" );
                    console.log(notification)
                    notification.to(key).emit('message',{type:"newMessage", fromId:socket.userId, roomId:socket.roomId, read_flg:0})
                }   
            });
            
        }

    }

    socket.on('message', (msg) => {
        funcSendMesage('mess', msg)   
    })

    //メッセージ画面を開いたときに、呼ばれてルームID、FROMID,TOIDを保持する
    socket.on('join',(data)=> {
        console.log('join formId:' + data.fromId)
        console.log('join roomId:' + data.roomId)
        console.log('join toId:' + data.toId)

        if(data.fromId != null){
            socket.userId = data.fromId
        }

        if(data.roomId != null){
            socket.roomId = data.roomId

            //ソケットIDとFromID（本人）を紐づける
            socketUserIdMap.set(socket.id, data.fromId)
            
            //指定された部屋に入室
            socket.join(socket.roomId)

            console.log(socket.userId + ' joined '+ socket.roomId)
            console.log(socketUserIdMap)
        }

        if(data.toId != null){
            socket.toId = data.toId
        }       
    })

    
    //接続解除時に呼ばれる
    socket.on('disconnect', () => {
        
        console.log('message disconnect')

        //退出する際にソケットIDと本人（FromID）の紐づけを解除
        socketUserIdMap.delete(socket.id)
        console.log(socketUserIdMap)

    });
})
        

http.listen(3000,()=>console.log('lisning on port 3000!'))