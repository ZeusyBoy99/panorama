"""Project OSM relation 6942508 to the circuit view; no runtime map requests."""
import xml.etree.ElementTree as ET
import math,json
from pathlib import Path
base=Path(__file__).resolve().parents[1]
r=ET.parse(base/'src/assets/mount-panorama-osm-source.osm').getroot()
nodes={n.get('id'):n for n in r.findall('node')};ways={w.get('id'):w for w in r.findall('way')}
rel=next(a for a in r.findall('relation') if a.get('id')=='6942508')
refs=[m.get('ref') for m in rel.findall('member') if m.get('role')=='circuit']
ordered=[];ranges=[]
for ref in refs:
 w=ways[ref];ids=[a.get('ref') for a in w.findall('nd')]
 if ordered and ordered[-1]!=ids[0]:
  if ordered[-1]==ids[-1]:ids.reverse()
  else:raise ValueError('Disconnected circuit '+ref)
 start=len(ordered)-1 if ordered else 0
 ordered.extend(ids[1:] if ordered else ids)
 name=next(t.get('v') for t in w.findall('tag') if t.get('k')=='name')
 ranges.append((name,start,len(ordered)-1))
assert ordered[0]==ordered[-1]
lon0=149.55;lat0=-33.45;cos=math.cos(math.radians(lat0))
def raw(ref):
 n=nodes[ref];return ((float(n.get('lon'))-lon0)*cos,-(float(n.get('lat'))-lat0))
a,b=raw(ordered[0]),raw(ordered[3]);theta=-math.atan2(b[1]-a[1],b[0]-a[0])-math.pi/2
def rotate(p):return (p[0]*math.cos(theta)-p[1]*math.sin(theta),p[0]*math.sin(theta)+p[1]*math.cos(theta))
rotated=[rotate(raw(i)) for i in ordered]
minx=min(p[0] for p in rotated);maxx=max(p[0] for p in rotated);miny=min(p[1] for p in rotated);maxy=max(p[1] for p in rotated)
scale=min(480/(maxx-minx),330/(maxy-miny))
left=(680-(maxx-minx)*scale)/2;top=(520-(maxy-miny)*scale)/2
project=lambda p:[round((p[0]-minx)*scale+left,3),round((p[1]-miny)*scale+top,3)]
points=[project(p) for p in rotated]
# Use the mapped finish-line node. It lies on Pit Straight; start/finish progress0 is its circuit projection.
finish=project(rotate(raw('4438410439')))
def nearest(p,ps):return min(range(len(ps)),key=lambda i:math.hypot(ps[i][0]-p[0],ps[i][1]-p[1]))
# Insert the line projection into the first straight edge, then rotate the closed loop to it.
idx=nearest(finish,points[:-1]);closed=points[:-1];closed.insert(idx+1,finish);points=closed[idx+1:]+closed[:idx+1]+[finish]
lengths=[0]
for a,b in zip(points,points[1:]):lengths.append(lengths[-1]+math.dist(a,b))
def progress(p):return lengths[nearest(p,points)]/lengths[-1]
# Pit route ordered from approach at Murrays to the exit before Hell Corner.
pitids=[]
for ref in ['37594848','385686852']:
 ids=[n.get('ref') for n in ways[ref].findall('nd')]
 if pitids and pitids[-1]!=ids[0]:ids.reverse()
 assert not pitids or pitids[-1]==ids[0]
 pitids.extend(ids[1:] if pitids else ids)
pitSource=[project(rotate(raw(i))) for i in pitids]
entryMain=points[nearest(pitSource[0],points)];exitMain=points[nearest(pitSource[-1],points)];pitSource=[entryMain]+pitSource+[exitMain]
# At this map scale the mapped pit road is only 2–3 SVG units from Pit Straight.
# The diagram's road/marker widths are larger, so widen the displayed lane toward
# the circuit interior. Keep the real coordinates separately and taper smoothly
# back to the exact mapped entry/exit. This is presentation spacing, not new GPS.
sourceLength=[0]
for a,b in zip(pitSource,pitSource[1:]):sourceLength.append(sourceLength[-1]+math.dist(a,b))
pitDisplayOffset=30
def smoothstep(t):
 t=max(0,min(1,t));return t*t*(3-2*t)
def pitOffset(distance):
 p=distance/sourceLength[-1]
 return pitDisplayOffset*min(smoothstep(p/.2),smoothstep((1-p)/.2))
pit=[[round(x-pitOffset(distance),3),y] for (x,y),distance in zip(pitSource,sourceLength)]
# Driver service is a synthetic point upstream of the finish line, not a measured pit stall.
pitlength=[0]
for a,b in zip(pit,pit[1:]):pitlength.append(pitlength[-1]+math.dist(a,b))
serviceIndex=round(len(pit)*.45);service=pit[serviceIndex];serviceProgress=pitlength[serviceIndex]/pitlength[-1]
finishCrossings=[]
for i,(a,b) in enumerate(zip(pit,pit[1:])):
 if a[1]>finish[1]>=b[1]:
  f=(a[1]-finish[1])/(a[1]-b[1])
  finishCrossings.append((pitlength[i]+f*math.dist(a,b))/pitlength[-1])
assert len(finishCrossings)==1,'Pit road must cross the horizontal finish line once'
finishPitProgress=finishCrossings[0]
anchors={}
for name,start,end in ranges:
 anchors[name]=project(rotated[(start+end)//2])
s1=anchors['The Cutting'];s2=anchors["Forrest's Elbow"]
# Manually placed text surrounds the sourced outline without changing geometry.
labels=[('Hell Corner',639,234,'end'),('Mountain Straight',454,235,'middle'),('Griffins Bend',300,263,'end'),('The Cutting',369,153,'start'),('Reid Park',266,212,'middle'),('Sulman Park',209,108,'middle'),('McPhillamy Park',127,143,'end'),('Skyline',116,224,'end'),('The Esses',109,281,'end'),('The Dipper',109,316,'end'),('Forrest’s Elbow',112,398,'middle'),('Conrod Straight',308,401,'middle'),('The Chase',454,429,'middle'),('Murray’s Corner',593,411,'end'),('Pit lane',533,315,'end')]
# Keep track shape centered and permit labels after projection inspection.
out='''/**\n * Geometry derived from OpenStreetMap relation 6942508, © OpenStreetMap contributors.\n * ODbL 1.0: https://www.openstreetmap.org/copyright\n * Local projection/rotation/scale by Panorama. The outline is geographical centerline data,\n * not surveyed telemetry. Sector/service anchors are synthetic. Familiar race-map rotation\n * aligns Pit Straight vertically as the Supercars circuit-map reference; racing follows the verified anti-clockwise route.\n * Displayed pit road is widened toward the interior for legibility; pitSourcePoints preserves mapped spacing.\n * Source retained in mount-panorama-osm-source.osm; regenerate with scripts/generate-track.py.\n */\nexport type TrackPoint = readonly [x:number,y:number];\nexport const trackViewBox='0 0 680 520';\nexport const trackGeometryNotice='Map © OpenStreetMap contributors · pit lane widened · demo sector anchors';\nexport const trackAttribution={url:'https://www.openstreetmap.org/copyright',label:'OpenStreetMap contributors',license:'ODbL 1.0'};\n'''
array=lambda x:json.dumps(x,separators=(',',':'))
out+='export const trackPoints:readonly TrackPoint[]='+array(points)+';\n'
out+='export const pitSourcePoints:readonly TrackPoint[]='+array(pitSource)+';\n'
out+='export const pitDisplayOffset='+str(pitDisplayOffset)+';\n'
out+='export const pitPoints:readonly TrackPoint[]='+array(pit)+';\n'
out+="const path=(p:readonly TrackPoint[])=>p.map(([x,y],i)=>(i?'L':'M')+x+','+y).join(' ');\nexport const trackPath=path(trackPoints)+' Z';\nexport const pitPath=path(pitPoints);\n"
out+='export const pitEntryAnchor={mainProgress:'+str(progress(entryMain))+',point:'+array(entryMain)+' as TrackPoint};\n'
out+='export const pitExitAnchor={mainProgress:'+str(progress(exitMain))+',point:'+array(exitMain)+' as TrackPoint};\n'
out+='export const pitServicePoint='+array(service)+' as TrackPoint;\nexport const pitServiceProgress='+str(serviceProgress)+';\nexport const pitFinishProgress='+str(finishPitProgress)+';\n'
# Draw line perpendicular to the straight, horizontal because Pit Straight was made vertical.
out+='export const startFinish={point:'+array(finish)+' as TrackPoint,line:[['+str(finish[0]-12)+','+str(finish[1])+'],['+str(finish[0]+12)+','+str(finish[1])+']] as readonly TrackPoint[],label:[670,'+str(finish[1]-7)+'] as TrackPoint};\n'
out+='export const sectorAnchors=[{id:"s1",label:"DEMO S1",progress:'+str(progress(s1))+',point:'+array(s1)+' as TrackPoint,labelPoint:'+array([s1[0]+24,s1[1]-16])+' as TrackPoint},{id:"s2",label:"DEMO S2",progress:'+str(progress(s2))+',point:'+array(s2)+' as TrackPoint,labelPoint:'+array([s2[0]-14,s2[1]+20])+' as TrackPoint},{id:"s3",label:"DEMO S3 / FINISH",progress:1,point:'+array(finish)+' as TrackPoint,labelPoint:'+array([finish[0],finish[1]-25])+' as TrackPoint}] as const;\n'
out+='export const trackLabels='+array([{'name':n,'x':x,'y':y,'anchor':anchor} for n,x,y,anchor in labels])+' as const;\n'
mp=anchors['Mountain Straight'];start=project(rotated[ranges[3][1]]);end=project(rotated[ranges[3][2]]);angle=math.degrees(math.atan2(end[1]-start[1],end[0]-start[0]))
out+='export const directionArrow={point:'+array(mp)+' as TrackPoint,rotation:'+str(angle)+'};\n'
out+='export const northArrow={rotation:'+str(math.degrees(theta)-90)+'};\n'
(base/'src/assets/track.ts').write_text(out)
print('Circuit points',len(points),'pit points',len(pit),'bounds',min(p[0] for p in points),max(p[0] for p in points),min(p[1] for p in points),max(p[1] for p in points))
print('Finish',finish,'pit entry/exit',progress(entryMain),progress(exitMain),'pit service/finish',serviceProgress,finishPitProgress)
print('Corner anchors:',json.dumps(anchors))
