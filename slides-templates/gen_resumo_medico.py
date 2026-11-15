#!/usr/bin/env python3
"""Gera os modelos de slide "Resumo Médico" (um por matéria) em slides-templates/resumo-<id>.pptx.
Tokens do sistema de design: só brand, brand-deep, tint-100/200/300 e line mudam por matéria."""
import copy, sys
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml.ns import qn
from lxml import etree

THEMES = {
  'cardiologia':   dict(nome='CARDIOLOGIA',   brand='B3261E', deep='7F1912', t1='FDF1F0', t2='F8D9D6', t3='F2BDB8', line='E8B4AF'),
  'pneumologia':   dict(nome='PNEUMOLOGIA',   brand='1F5FAF', deep='123B70', t1='EEF4FB', t2='D4E4F6', t3='B5CFEE', line='A9C4E4'),
  'neurologia':    dict(nome='NEUROLOGIA',    brand='0F766E', deep='0A4B46', t1='EDF8F6', t2='CBEDE8', t3='A8DDD6', line='9BD0C9'),
  'endocrinologia':dict(nome='ENDOCRINOLOGIA',brand='B45309', deep='78350F', t1='FEF6E7', t2='FCE5B8', t3='F8D48A', line='EBC27A'),
}
SURFACE='FFFFFF'; NOTE='F5F6F8'; INK='1A1D24'; MUTED='5A6172'; RULE='C3C8D2'; ONBRAND='FFFFFF'
FONT='Poppins'
W,H=Inches(13.333),Inches(7.5); M=Inches(0.7)

def rgb(h): return RGBColor.from_string(h)

def box(sl,x,y,w,h,fill=None,line=None,lw=None):
    s=sl.shapes.add_shape(MSO_SHAPE.RECTANGLE,x,y,w,h)
    s.shadow.inherit=False
    if fill: s.fill.solid(); s.fill.fore_color.rgb=rgb(fill)
    else: s.fill.background()
    if line: s.line.color.rgb=rgb(line); s.line.width=Pt(lw or 1)
    else: s.line.fill.background()
    return s

def text(sl,x,y,w,h,paras,size=18,color=INK,bold=False,align=PP_ALIGN.LEFT,anchor=MSO_ANCHOR.TOP,italic=False,spacing=None):
    tb=sl.shapes.add_textbox(x,y,w,h); tf=tb.text_frame; tf.word_wrap=True
    tf.margin_left=tf.margin_right=Emu(0); tf.margin_top=tf.margin_bottom=Emu(0); tf.vertical_anchor=anchor
    if isinstance(paras,str): paras=[paras]
    for i,p in enumerate(paras):
        para=tf.paragraphs[0] if i==0 else tf.add_paragraph()
        para.alignment=align
        if spacing: para.space_after=Pt(spacing)
        runs=p if isinstance(p,list) else [(p,bold)]
        for t,b in runs:
            r=para.add_run(); r.text=t; r.font.name=FONT; r.font.size=Pt(size); r.font.bold=b; r.font.italic=italic; r.font.color.rgb=rgb(color)
    return tb

def eyebrow(sl,th,color=None):
    text(sl,M,Inches(0.45),Inches(6),Inches(0.3),th['nome'],size=11,color=color or th['brand'],bold=True)

def title(sl,th,t):
    # título em caixa alta: marca-texto tint-200 por trás e sublinhado brand de 4px
    w=Inches(11.9)
    box(sl,M,Inches(0.95),Inches(min(11.9,0.205*len(t)+0.5)),Inches(0.62),fill=th['t2'])
    text(sl,M+Inches(0.12),Inches(0.98),w,Inches(0.56),t.upper(),size=26,bold=True,anchor=MSO_ANCHOR.MIDDLE)
    box(sl,M,Inches(1.6),Inches(11.9),Emu(int(Pt(4))),fill=th['brand'])

def footer(sl,th,src='Base: Livro Estratégico – Professor(a)'):
    text(sl,M,Inches(7.0),Inches(9),Inches(0.3),src,size=10,color=MUTED)
    tb=text(sl,Inches(11.2),Inches(7.0),Inches(1.43),Inches(0.3),'',size=10,color=MUTED,align=PP_ALIGN.RIGHT)
    p=tb.text_frame.paragraphs[0]._p
    for r in p.findall(qn('a:r')): p.remove(r)
    fld=etree.SubElement(p,qn('a:fld')); fld.set('id','{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}'); fld.set('type','slidenum')
    rpr=etree.SubElement(fld,qn('a:rPr')); rpr.set('lang','pt-BR'); rpr.set('sz','1000')
    sf=etree.SubElement(rpr,qn('a:solidFill')); c=etree.SubElement(sf,qn('a:srgbClr')); c.set('val',MUTED)
    lat=etree.SubElement(rpr,qn('a:latin')); lat.set('typeface',FONT)
    t=etree.SubElement(fld,qn('a:t')); t.text='‹#›'

def bg(sl,color):
    box(sl,0,0,W,H,fill=color)

def left_rule(sl,x,y,w,h,fill,rule):
    box(sl,x,y,w,h,fill=fill); box(sl,x,y,Emu(int(Pt(3))),h,fill=rule)

def build(tid,th,path):
    prs=Presentation(); prs.slide_width=W; prs.slide_height=H
    blank=prs.slide_layouts[6]
    # 1) capa
    s=prs.slides.add_slide(blank); bg(s,th['brand'])
    text(s,M,Inches(2.2),Inches(8),Inches(0.4),th['nome'],size=14,color=ONBRAND,bold=True)
    box(s,M,Inches(2.7),Inches(1.2),Emu(int(Pt(4))),fill=ONBRAND)
    text(s,M,Inches(3.0),Inches(11.5),Inches(1.6),'TÍTULO DA AULA',size=44,color=ONBRAND,bold=True,anchor=MSO_ANCHOR.TOP)
    text(s,M,Inches(4.7),Inches(10),Inches(0.8),'Subtítulo ou tópico principal',size=20,color=ONBRAND)
    text(s,M,Inches(6.9),Inches(11),Inches(0.3),'Base: Livro Estratégico – Professor(a)   |   (acrescentado) = complemento fora do livro',size=10,color=ONBRAND)
    # 2) tópicos
    s=prs.slides.add_slide(blank); eyebrow(s,th); title(s,th,'Tópico principal')
    linhas=[[('Conceito-chave: ',True),('definição curta e direta',False)],
            [('Fisiopatologia: ',True),('causa ',False),('→',False),(' mecanismo ',False),('→',False),(' achado',False)],
            [('Diagnóstico: ',True),('ECG, exames e critérios',False)],
            [('Conduta: ',True),('primeira linha ',False),('→',False),(' alternativa',False)],
            [('Complemento ',False),('(acrescentado)',False)],
            [('Pegadinha de prova: ',True),('o que costuma cair',False)]]
    text(s,M,Inches(2.0),Inches(11.9),Inches(4.6),linhas,size=20,spacing=10)
    footer(s,th)
    # 3) tabela
    s=prs.slides.add_slide(blank); eyebrow(s,th); title(s,th,'Tabela comparativa')
    text(s,M,Inches(1.85),Inches(11.9),Inches(0.35),[[('Tabela 1',True),(' – título da tabela',False)]],size=12,color=MUTED)
    rows,cols=4,4
    gs=s.shapes.add_table(rows,cols,M,Inches(2.3),Inches(11.9),Inches(3.4)); tbl=gs.table
    tblPr=gs._element.graphic.graphicData.tbl.tblPr
    for a in ('firstRow','bandRow'): tblPr.set(a,'0')
    sid=tblPr.find(qn('a:tableStyleId'))
    if sid is not None: tblPr.remove(sid)
    data=[['Característica','Tipo A','Tipo B','Tipo C'],['Mecanismo','—','—','—'],['Achado típico','—','—','—'],['Conduta','—','—','—']]
    for r in range(rows):
        tbl.rows[r].height=Inches(0.85)
        for c in range(cols):
            cell=tbl.cell(r,c); cell.text=''; tf=cell.text_frame; p=tf.paragraphs[0]
            run=p.add_run(); run.text=data[r][c]; run.font.name=FONT; run.font.size=Pt(16); run.font.bold=(r==0 or c==0)
            run.font.color.rgb=rgb(ONBRAND if r==0 else INK)
            cell.fill.solid(); cell.fill.fore_color.rgb=rgb(th['brand'] if r==0 else th['t1'])
            cell.vertical_anchor=MSO_ANCHOR.MIDDLE; cell.margin_left=cell.margin_right=Inches(0.14)
            tcPr=cell._tc.get_or_add_tcPr()
            for tag in ('a:lnL','a:lnR','a:lnT','a:lnB'):
                ln=etree.SubElement(tcPr,qn(tag)); ln.set('w','12700' if tag in('a:lnT','a:lnB') else '0')
                if tag in('a:lnT','a:lnB'):
                    sf=etree.SubElement(ln,qn('a:solidFill')); cc=etree.SubElement(sf,qn('a:srgbClr')); cc.set('val',th['line'])
                else: etree.SubElement(ln,qn('a:noFill'))
            # a ordem do schema pede as bordas antes do preenchimento
            fills=[e for e in tcPr if e.tag in (qn('a:solidFill'),qn('a:noFill'))]
            for e in fills: tcPr.remove(e); tcPr.append(e)
    footer(s,th)
    # 4) fluxograma
    s=prs.slides.add_slide(blank); eyebrow(s,th); title(s,th,'Fluxograma de conduta')
    cx=Inches(4.2); cw=Inches(4.9)
    def fbox(y,txt,fill=SURFACE,fg=INK,line=th['brand'],bold=False):
        b=box(s,cx,y,cw,Inches(0.62),fill=fill,line=line,lw=1.5)
        tf=b.text_frame; tf.margin_left=tf.margin_right=Inches(0.1); tf.vertical_anchor=MSO_ANCHOR.MIDDLE
        p=tf.paragraphs[0]; p.alignment=PP_ALIGN.CENTER; r=p.add_run(); r.text=txt; r.font.name=FONT; r.font.size=Pt(15); r.font.bold=bold; r.font.color.rgb=rgb(fg)
    def arrow(y): text(s,cx,y,cw,Inches(0.25),'▼',size=12,color=th['brand'],align=PP_ALIGN.CENTER)
    fbox(Inches(1.9),'Paciente com a queixa principal',fill=th['brand'],fg=ONBRAND,line=th['brand'],bold=True); arrow(Inches(2.55))
    fbox(Inches(2.85),'Instável?  Sim → conduta imediata'); arrow(Inches(3.5))
    fbox(Inches(3.8),'Estável: investigar com exames'); arrow(Inches(4.45))
    fbox(Inches(4.75),'Tratamento dirigido'); arrow(Inches(5.4))
    fbox(Inches(5.7),'Seguimento e prevenção',fill=th['deep'],fg=ONBRAND,line=th['deep'],bold=True)
    footer(s,th)
    # 5) caixas
    s=prs.slides.add_slide(blank); eyebrow(s,th); title(s,th,'Caixas de destaque')
    left_rule(s,M,Inches(2.0),Inches(11.9),Inches(1.7),NOTE,RULE)
    text(s,M+Inches(0.3),Inches(2.15),Inches(11.3),Inches(0.3),'EXPLICAÇÃO',size=11,color=MUTED,bold=True)
    text(s,M+Inches(0.3),Inches(2.55),Inches(11.3),Inches(1.0),'Texto de apoio curto e telegráfico. Use abreviações da área sem explicar (FC, MP, BAV, ECG, IV).',size=18)
    left_rule(s,M,Inches(4.1),Inches(11.9),Inches(1.9),th['t3'],th['deep'])
    text(s,M+Inches(0.3),Inches(4.25),Inches(11.3),Inches(0.3),'PEGADINHA DE PROVA',size=11,color=th['deep'],bold=True)
    text(s,M+Inches(0.3),Inches(4.65),Inches(11.3),Inches(1.2),[[('IAM anterior ',False),('→',False),(' BAV infra-hissiano: ',False),('MP definitivo',True)]],size=18,color=th['deep'])
    footer(s,th)
    prs.core_properties.title='Resumo Médico – '+th['nome'].title()
    prs.save(path)

if __name__=='__main__':
    out=sys.argv[1] if len(sys.argv)>1 else '.'
    for tid,th in THEMES.items(): build(tid,th,f'{out}/resumo-{tid}.pptx')
    print('ok')
