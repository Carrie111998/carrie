import asyncio,json,time,os,math,requests
import pandas as pd,numpy as np
from datetime import datetime,timezone
from contextlib import asynccontextmanager
from fastapi import FastAPI,WebSocket,WebSocketDisconnect
from fastapi.responses import HTMLResponse
DD=os.environ.get("DATA_DIR","data");os.makedirs(DD,exist_ok=True)
TF=os.path.join(DD,"trades.json")
class P:
 def __init__(s):s.rp=14;s.ro=70.0;s.rs=30.0;s.mf=12;s.ms=26;s.mg=9;s.bp=20;s.bs=2.0;s.rw=.35;s.mw=.35;s.bw=.30;s.bt=.5;s.st=-.5
class S:
 def __init__(s,p=None):s.p=p or P();s.ah=[]
 def rsi(s,c):
  d=c.diff();g=d.where(d>0,0.0);l=-d.where(d<0,0.0)
  return(100-(100/(1+g.rolling(s.p.rp,min_periods=1).mean()/l.rolling(s.p.rp,min_periods=1).mean().replace(0,np.nan)))).fillna(50)
 def macd(s,c):
  m=c.ewm(span=s.p.mf,adjust=False).mean()-c.ewm(span=s.p.ms,adjust=False).mean()
  return m-m.ewm(span=s.p.mg,adjust=False).mean()
 def bb(s,c):
  sm=c.rolling(s.p.bp,min_periods=1).mean();st=c.rolling(s.p.bp,min_periods=1).std().fillna(0)
  return sm+s.p.bs*st,sm,sm-s.p.bs*st
 def sig(s,df):
  p=s.p
  if len(df)<max(p.ms,p.bp,p.rp)+5:return{"signal":"HOLD","score":0}
  c=df["close"];cp=c.iloc[-1];cr=s.rsi(c).iloc[-1]
  rv=1 if cr<=p.rs else(-1 if cr>=p.ro else-((cr-50)/50))
  h=s.macd(c);ch=float(h.iloc[-1]);ph=float(h.iloc[-2]) if len(h)>1 else 0
  mv=1 if(ch>0 and ph<=0) else(-1 if(ch<0 and ph>=0) else np.clip(ch/(abs(ch)+1),-1,1))
  u,sm,lo=s.bb(c);br=float(u.iloc[-1]-lo.iloc[-1]) or 1;bp=(cp-float(lo.iloc[-1]))/br
  bv=1 if bp<=.1 else(-1 if bp>=.9 else-(bp-.5)*2)
  sc=rv*p.rw+mv*p.mw+bv*p.bw;sg="BUY" if sc>=p.bt else("SELL" if sc<=p.st else "HOLD")
  return{"signal":sg,"score":round(sc,4),"price":cp,"indicators":{"rsi":round(cr,2),"rs":round(rv,4),"ms":round(float(mv),4),"bs":round(bv,4)}}
 def adj(s,trades):
  if len(trades)<5:return{"adjusted":False}
  p=s.p;lo=[t for t in trades if t.get("pnl",0)<0];wi=[t for t in trades if t.get("pnl",0)>=0]
  if not lo:return{"adjusted":False}
  wr=len(wi)/len(trades);ch=[]
  if sum(1 for t in lo if t.get("er",50)>40 and t.get("side")=="BUY")>len(lo)*.3:o=p.rs;p.rs=max(20,o-2);ch.append(f"os:{o}->{p.rs}")
  if sum(1 for t in lo if t.get("er",50)<60 and t.get("side")=="SELL")>len(lo)*.3:o=p.ro;p.ro=min(85,o+2);ch.append(f"ob:{o}->{p.ro}")
  if wr<.45:p.bt=min(.8,p.bt+.05);p.st=max(-.8,p.st-.05);ch.append("thr")
  ar=np.mean([abs(t.get("ers",0)) for t in lo]);am=np.mean([abs(t.get("ems",0)) for t in lo]);ab=np.mean([abs(t.get("ebs",0)) for t in lo]);w=max(ar,am,ab)
  if w>0:
   if ar==w and p.rw>.15:p.rw-=.03;p.mw+=.015;p.bw+=.015;ch.append(f"rw{p.rw:.3f}")
   elif am==w and p.mw>.15:p.mw-=.03;p.rw+=.015;p.bw+=.015;ch.append(f"mw{p.mw:.3f}")
   elif ab==w and p.bw>.15:p.bw-=.03;p.rw+=.015;p.mw+=.015;ch.append(f"bw{p.bw:.3f}")
  a={"adjusted":len(ch)>0,"changes":ch,"win_rate":round(wr,4),"total_trades":len(trades)};s.ah.append(a);return a
 def pd(s):return{"rsi_oversold":s.p.rs,"rsi_overbought":s.p.ro,"buy_threshold":s.p.bt,"sell_threshold":s.p.st,"rsi_weight":s.p.rw,"macd_weight":s.p.mw,"bb_weight":s.p.bw}
class T:
 def __init__(s,b=10000.0):s.ib=b;s.bal=b;s.pos={};s.trades=[];s.tc=0;s._ld()
 def _ld(s):
  if os.path.exists(TF):
   try:d=json.load(open(TF));s.trades=d.get("t",[]);s.bal=d.get("b",s.ib);s.tc=d.get("c",0)
   except:pass
 def _sv(s):json.dump({"t":s.trades,"b":s.bal,"c":s.tc},open(TF,"w"))
 def op(s,sym,side,price,ind):
  if sym in s.pos:return None
  a=s.bal*.1;q=a/price;s.pos[sym]={"s":side,"p":price,"q":q,"i":ind}
  return{"action":"OPENED","symbol":sym,"side":side,"entry_price":price}
 def cl(s,sym,price,ind):
  if sym not in s.pos:return None
  p=s.pos[sym];pnl=(price-p["p"])*p["q"] if p["s"]=="BUY" else(p["p"]-price)*p["q"]
  s.bal+=pnl;s.tc+=1;ei=p["i"]
  s.trades.append({"id":s.tc,"symbol":sym,"side":p["s"],"entry_price":p["p"],"exit_price":price,"pnl":round(pnl,4),"er":ei.get("rsi",0),"ers":ei.get("rs",0),"ems":ei.get("ms",0),"ebs":ei.get("bs",0)})
  del s.pos[sym];s._sv()
  return{"action":"CLOSED","symbol":sym,"side":p["s"],"entry_price":p["p"],"exit_price":price,"pnl":round(pnl,4),"balance":round(s.bal,2)}
 def st(s):
  t=s.trades
  if not t:return{"total_trades":0,"win_rate":0,"total_pnl":0,"balance":round(s.bal,2),"initial_balance":s.ib,"return_pct":0}
  w=sum(1 for x in t if x["pnl"]>=0);tp=sum(x["pnl"] for x in t)
  return{"total_trades":len(t),"win_rate":round(w/len(t)*100,2),"total_pnl":round(tp,4),"balance":round(s.bal,2),"initial_balance":s.ib,"return_pct":round(((s.bal-s.ib)/s.ib)*100,2)}
 def reset(s):
  s.bal=s.ib;s.pos={};s.trades=[];s.tc=0
  if os.path.exists(TF):os.remove(TF)
SYMS=["BNBUSDT","BTCUSDT","ETHUSDT"];SIM=False;SP={"BNBUSDT":580.0,"BTCUSDT":67000.0,"ETHUSDT":3500.0};SS={}
strat=S();trd=T();run=False;cls=[];lsig={}
def simk(sym):
 b=SP.get(sym,1e3);SS[sym]=SS.get(sym,0)+1;np.random.seed(int(time.time())%10000+hash(sym)%1000)
 v=b*.003;p=[b]
 for i in range(99):p.append(p[-1]+math.sin(SS[sym]*.1+i*.05)*v*.5+np.random.randn()*v+(b-p[-1])*.02)
 c=np.array(p);SP[sym]=c[-1]
 return pd.DataFrame({"close":c,"open":np.roll(c,1),"high":c+abs(np.random.randn(100))*v*.5,"low":c-abs(np.random.randn(100))*v*.5,"volume":np.random.randint(1e3,5e4,100).astype(float)})
def fetch(sym):
 global SIM
 if SIM:return simk(sym)
 try:r=requests.get("https://api.binance.com/api/v3/klines",params={"symbol":sym,"interval":"5m","limit":100},timeout=10);r.raise_for_status();d=r.json()
 except:SIM=True;return simk(sym)
 df=pd.DataFrame(d,columns=["ot","open","high","low","close","volume","ct","qv","tr","tb","tq","ig"])
 for x in["open","high","low","close","volume"]:df[x]=df[x].astype(float)
 return df
async def bc(msg):
 t=json.dumps(msg);rm=[]
 for w in cls:
  try:await w.send_text(t)
  except:rm.append(w)
 for w in rm:cls.remove(w)
async def loop():
 global run
 while run:
  for sym in SYMS:
   try:
    df=fetch(sym);sg=strat.sig(df);sg["symbol"]=sym;lsig[sym]=sg;tr=None
    if sg["signal"]=="BUY":
     if sym not in trd.pos:tr=trd.op(sym,"BUY",sg["price"],sg["indicators"])
     elif trd.pos[sym]["s"]=="SELL":tr=trd.cl(sym,sg["price"],sg["indicators"])
    elif sg["signal"]=="SELL":
     if sym in trd.pos:tr=trd.cl(sym,sg["price"],sg["indicators"])
     else:tr=trd.op(sym,"SELL",sg["price"],sg["indicators"])
    if tr:
     await bc({"type":"trade","data":tr})
     if len(trd.trades)%5==0 and len(trd.trades)>=5:
      a=strat.adj(trd.trades)
      if a["adjusted"]:await bc({"type":"adjustment","data":a})
    await bc({"type":"signal","data":sg})
   except:pass
  ps={k:{"symbol":k,"side":v["s"],"entry_price":v["p"],"quantity":round(v["q"],6)} for k,v in trd.pos.items()}
  await bc({"type":"stats","data":{**trd.st(),"positions":ps,"params":strat.pd()}});await asyncio.sleep(15)
@asynccontextmanager
async def lifespan(a):yield;global run;run=False
app=FastAPI(lifespan=lifespan)
HP=os.path.join(os.path.dirname(__file__),"index.html")
HTML=open(HP).read() if os.path.exists(HP) else "<h1>Bot</h1>"
@app.get("/")
async def root():return HTMLResponse(HTML)
@app.get("/api/status")
async def status():return{"running":run,"data_source":"simulation" if SIM else "live","stats":trd.st(),"params":strat.pd(),"signals":lsig}
@app.post("/api/start")
async def start():
 global run
 if run:return{"s":"on"}
 run=True;asyncio.create_task(loop());return{"s":"ok"}
@app.post("/api/stop")
async def stop():global run;run=False;return{"s":"ok"}
@app.post("/api/reset")
async def do_reset():
 global run;run=False;await asyncio.sleep(1);trd.reset();global strat;strat=S();return{"s":"ok"}
@app.get("/api/trades")
async def gt():return{"trades":trd.trades[-50:]}
@app.get("/api/adjustments")
async def ga():return{"a":strat.ah}
@app.websocket("/ws")
async def wse(ws:WebSocket):
 await ws.accept();cls.append(ws)
 await ws.send_text(json.dumps({"type":"init","data":{"running":run,"stats":trd.st(),"signals":lsig,"params":strat.pd()}}))
 try:
  while True:
   d=await ws.receive_text();m=json.loads(d)
   if m.get("action")=="start":await start()
   elif m.get("action")=="stop":await stop()
 except WebSocketDisconnect:
  if ws in cls:cls.remove(ws)
if __name__=="__main__":
 import uvicorn;uvicorn.run(app,host="0.0.0.0",port=8888)
