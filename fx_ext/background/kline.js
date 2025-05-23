'use strict';

(function(){

const { logger, svrd } = xreq('./background/nbase.js');
const { feng } = xreq('./background/feng.js');
const { guang } = xreq('./background/guang.js');

const klPad = {
    klines: {},
    loadKlines(code) {
        if (!this.klines[code]) {
            this.klines[code] = new KLine(code);
            this.klines[code].loadSaved();
        }
    },
    getStockZt(code) {
        const lclose = this.klines[code]?.getKline('101')?.slice(-1)[0]?.c;
        return feng.getStockZt(code, lclose);
    },
    getStockDt(code) {
        const lclose = this.klines[code]?.getKline('101')?.slice(-1)[0]?.c;
        return feng.getStockDt(code, lclose);
    },
    /**
    * 获取股票K线数据, 常用日K，1分， 15分
    * @param {string} code 股票代码, 如: 002261
    * @param {number} klt K线类型，101: 日k 102: 周k 103: 月k 104: 季k 105: 半年k 106:年k 60: 小时 120: 2小时, 其他分钟数 1, 5, 15,30
    * @param {string} date 用于大于日K的请求，设置开始日期如： 20201111
    * @returns {Promise<any>} 返回数据的 Promise
    */
    async getStockKline(code, klt, date) {
        return feng.getStockKline(code, klt, date).then(kldata => {
            if (!kldata) {
                return {};
            }
            if (!this.klines[code]) {
                this.klines[code] = new KLine(code);
            }
            let updatedKlt = this.klines[code].updateRtKline(kldata);
            return Object.fromEntries(updatedKlt.map(x => [x, this.klines[code].klines[x]]));
        });
    },
    async getStockMinutesKline(code, days=2) {
        return feng.getStockMinutesKline(code, days).then(kldata => {
            if (!kldata) {
                return {};
            }
            if (!this.klines[code]) {
                this.klines[code] = new KLine(code);
            }
            let updatedKlt = this.klines[code].updateRtKline(kldata);
            return Object.fromEntries(updatedKlt.map(x => [x, this.klines[code].klines[x]]));
        });
    }
}


class KLine {
    constructor(code) {
        this.code = code;
        this.storeKey = 'kline_' + this.code;
        this.baseKlt = new Set(['1', '15', '101']);
        this.factors = [2, 4, 8];
        this.incompleteKline = {};
        this.klvars = new Set(); // k线指标
    }

    parseKlVars() {
        for (var i in this.klines) {
            for (var j = 0; j < this.klines[i].length; ++j) {
                for (var k in this.klines[i][j]) {
                    if (['h','l','o','c','time','v'].includes(k)) {
                        continue;
                    }
                    this.klvars.add(k);
                }
                if (this.klvars.size > 0) {
                    return;
                }
            }
        }
    }

    addKlvars(kvs) {
        if (!kvs) {
            return;
        }

        if (typeof(kvs) === 'string') {
            this.klvars.add(kvs);
            return;
        }

        kvs.forEach(k => {
            this.klvars.add(k);
        });
    }

    kltimeExpired(kt) {
        var t = new Date();
        if (t.getDay() == 1 && t - new Date(kt) > 72*3600000) {
            return true;
        }
        return t - new Date(kt) > 24*3600000;
    }

    loadSaved(cb) {
        if (this.code.startsWith('t')) {
            if (typeof(cb) === 'function') {
                cb(this.code);
            }
            return;
        }
        svrd.getFromLocal(this.storeKey).then(klines => {
            if (klines) {
                this.klines = klines;
                for (var i in this.klines) {
                    if (this.klines[i].length > 240 && i - 120 < 0) {
                        this.klines[i] = this.klines[i].slice(this.klines[i].length - 240);
                    }
                    if (i - 10 < 0 && this.klines[i].length > 0 && this.kltimeExpired(this.klines[i][this.klines[i].length - 1].time)) {
                        console.log(this.code);
                        this.klines[i] = [];
                    }
                }
                this.parseKlVars();
            };
            if (typeof(cb) === 'function') {
                cb(this.code);
            }
        });
    }

    save() {
        if (this.code.startsWith('t')) {
            return;
        }
        if (this.klines) {
            var stockKlines = {};
            stockKlines[this.storeKey] = this.klines;
            svrd.saveToLocal(stockKlines);
        };
    }

    removeAll() {
        if (this.klines !== undefined) {
            delete(this.klines);
        };
        svrd.removeLocal(this.storeKey);
    }

    getKline(kltype) {
        return this.klines[kltype];
    }

    getIncompleteKline(kltype) {
        if (this.incompleteKline) {
            return this.incompleteKline[kltype];
        };
        return null;
    }

    getLastNKlines(kltype, n) {
        // 获取最新k线之前n个k线, 配合getLatestKline使用
        var inkl = this.getIncompleteKline(kltype);
        if (!this.klines || !this.klines[kltype] || this.klines[kltype].length == 0) {
            return [];
        }

        var kline = this.klines[kltype];
        var lidx = kline.length;
        if (!inkl) {
            lidx--;
        }
        return kline.slice(lidx - n >= 0 ? lidx - n : 0, lidx);
    }

    getLatestPrice() {
        let latestKls = Array.from(this.baseKlt).map(k=>this.getLatestKline(k)).filter(Boolean).slice(0).map(kl => {
            let kl1 = {...kl};
            if (!kl.time.includes(' ')) {
                kl1.time += ' 15:00';
            }
            return kl1;
        });
        latestKls.sort((x, y) => x.time < y.time ? -1 : 1);
        return latestKls.slice(-1)[0].c;
    }

    getLatestKline(kltype='101') {
        var kl = this.getIncompleteKline(kltype);
        if (kl) {
            return kl;
        };
        if (this.klines && this.klines[kltype] && this.klines[kltype].length > 0) {
            return this.klines[kltype][this.klines[kltype].length - 1];
        };
        return null;
    }

    getPrevKline(kltype) {
        var kl = this.getIncompleteKline(kltype);
        if (!this.klines || !this.klines[kltype] || this.klines[kltype].length == 0) {
            return kl;
        }

        var prevId = this.klines[kltype].length - 1;
        if (!kl) {
            prevId --;
        }

        return this.klines[kltype][prevId];
    }

    getKlineByTime(t, kltype='101') {
        var inkl = this.getIncompleteKline(kltype);
        if (inkl && inkl.time == t) {
            return inkl;
        }

        if (!this.klines || !this.klines[kltype] || this.klines[kltype].length == 0) {
            return;
        }

        var kline = this.klines[kltype];
        for (var i = kline.length - 1; i >= 0; i--) {
            if (kline[i].time == t) {
                return kline[i];
            }
        }
    }

    getPrevKlineByTime(t, kltype='101') {
        if (!this.klines || !this.klines[kltype] || this.klines[kltype].length == 0) {
            return;
        }

        var inkl = this.getIncompleteKline(kltype);
        var kline = this.klines[kltype];
        if (inkl && inkl.time == t) {
            return kline[kline.length - 1];
        }

        for (var i = kline.length - 1; i > 0; i--) {
            if (kline[i].time == t) {
                return kline[i-1];
            }
        }
    }

    getKlinesSince(t, kltype) {
        if (!this.klines || !this.klines[kltype] || this.klines[kltype].length == 0) {
            return [];
        }

        var kline = this.klines[kltype];
        if (kline[kline.length - 1].time < t) {
            return [];
        }
        for (var i = kline.length - 1; i >= 0; i--) {
            if (kline[i].time == t) {
                return kline.slice(i);
            }
        }
        return kline;
    }

    getLatestBss(mlen, kltype='101') {
        // 最新k线的bss值
        if (!this.klines || !this.klines[kltype] || this.klines[kltype].length == 0) {
            return 'u';
        }

        var inkl = this.getIncompleteKline(kltype);
        if (inkl && inkl['bss'+mlen] !== undefined) {
            return inkl['bss'+mlen];
        }

        var kline = this.klines[kltype];
        if (kline[kline.length - 1]['bss' + mlen] === undefined) {
            this.calcKlineBss(kline, mlen);
        }

        if (!inkl) {
            return kline[kline.length - 1]['bss' + mlen];
        }
        return this.getNextKlBss(kline, inkl, mlen);
    }

    closeIsTopMost(kl, kltype = '101') {
        if (kl.h - kl.c > 0) {
            return false;
        }

        var tm = kl.time;
        var inkl = this.getIncompleteKline(kltype);
        var kline = this.klines[kltype];
        var preId = kline.length - 1;
        if (!inkl || inkl.time != tm) {
            while (preId > 0) {
                if (kline[preId].time == tm) {
                    preId--;
                    break;
                }
                preId--;
            }
        }
        if (preId >= 0) {
            var prekl = kline[preId];
            if (kl.c - (prekl.c * 0.1).toFixed(2) - prekl.c >= 0) {
                return true;
            }
            if (kl.c - (prekl.c * 1.1).toFixed(2) >= 0) {
                return true;
            }
            if (kl.c - (prekl.c * 0.05).toFixed(2) - prekl.c >= 0) {
                return true;
            }
            if (kl.c - (prekl.c * 1.05).toFixed(2) >= 0) {
                return true;
            }
        }
        return false;
    }

    lastClosePrice(date, kltype = '101') {
        // date之前一天的收盘价, 没有则返回当日开盘价
        var inkl = this.getIncompleteKline(kltype);
        if (inkl) {
            if (inkl.time < date) {
                return inkl.c;
            }
        }

        var kline = this.klines[kltype];
        if (kline.length == 0) {
            return 0;
        }
        for (var i = kline.length - 1; i >= 0; i--) {
            if (kline[i].time < date) {
                return kline[i].c;
            }
        }
        return kline[0].o;
    }

    latestKlineDrawback(kltype='101') {
        // 上影线比例
        var kl = this.getIncompleteKline(kltype);
        var prevId = this.klines[kltype].length - 1;
        if (!kl) {
            kl = this.klines[kltype][prevId];
            prevId --;
        }
        var lc = kl.o;
        if (prevId >= 0) {
            lc = this.klines[kltype][prevId].c;
        }
        var o = kl.o;
        var h = kl.h;
        var c = kl.c;
        var start = lc - o > 0 ? o : lc;
        return (h - c) / (h - start);
    }

    latestKlinePopup(kltype='101') {
        var kl = this.getIncompleteKline(kltype);
        var prevId = this.klines[kltype].length - 1;
        if (!kl) {
            kl = this.klines[kltype][prevId];
            prevId --;
        }
        var lc = kl.o;
        if (prevId >= 0) {
            lc = this.klines[kltype][prevId].c;
        }
        var o = kl.o;
        var l = kl.l;
        var c = kl.c;
        var start = lc - o > 0 ? lc : o;
        return (c - l) / (start - l);
    }

    latestKlinePercentage(kltype='101') {
        var kl = this.getIncompleteKline(kltype);
        if (!this.klines[kltype]) {
            return 0;
        }

        var prevId = this.klines[kltype].length - 1;
        if (!kl) {
            kl = this.klines[kltype][prevId];
            prevId --;
        }

        var lc = kl.o;
        if (prevId >= 0) {
            lc = this.klines[kltype][prevId].c;
        }

        return (kl.c - lc) / lc;
    }

    getNowTime() {
        return new Date();
    }

    parseKlines(kline, stime = '0', kltype = '1') {
        this.incompleteKline[kltype] = null;
        kline = kline.filter(x => x.time >= stime);
        if (kline.length == 0) {
            return kline;
        }
        const etime = kline[kline.length - 1].time;
        const now = this.getNowTime();
        var tDate = new Date(etime);
        if (kltype == '101') {
            tDate.setHours(15);
        };
        if (now < tDate) {
            this.incompleteKline[kltype] = kline.pop();
        };

        return kline;
    }

    calcAllKlineVars(klines) {
        this.klvars.forEach(x => {
            if (x.startsWith('ma')) {
                this.calcKlineMA(klines, parseInt(x.substring(2)));
            } else if (x.startsWith('bss')) {
                this.calcKlineBss(klines, parseInt(x.substring(3)));
            } else if (x == 'td') {
                this.calcKlineTd(klines);
            } else if (x.startsWith('bias')) {
                this.calcKlineBias(klines, parseInt(x.substring(4)));
            } else {
                if (x != 'prc' && x != 'pc') {
                    console.warn('Unknown klvar:', x);
                }
            }
        });
    }

    calcKlineMA(klines, mlen) {
        var len = 0;
        var sum = 0;
        for (var i = 0; i < klines.length; i++) {
            sum += parseFloat(klines[i].c);
            if (len < mlen) {
                len ++;
            } else {
                if (i >= mlen) {
                    sum -= klines[i - mlen].c;
                }
            }
            klines[i]['ma' + mlen] = (sum / len).toFixed(3);
        }
    }

    calcKlineBss(klines, mlen) {
        if (klines.length < 2) {
            for (var i = 0; i < klines.length; i++) {
                klines[i]['bss' + mlen] = 'u';
            }
            return;
        };
        klines[0]['bss' + mlen] = 'u';
        klines[1]['bss' + mlen] = 'u';
        for (var i = 1; i < klines.length; i++) {
            klines[i]['bss' + mlen] = this.getNextKlBss(klines.slice(0, i), klines[i], mlen);
        };
    }

    singleTd(kl, k4, td) {
        var rtd = td;
        if (kl.c - k4.c > 0) {
            if (td >= 0) {
                rtd += 1;
            } else {
                rtd = 0;
            }
        } else if (kl.c - k4.c < 0) {
            if (td <= 0) {
                rtd -= 1;
            } else {
                rtd = 0;
            }
        }
        return rtd;
    }

    calcKlineTd(klines) {
        for (var i = 0; i < klines.length; ++i) {
            if (i < 4) {
                klines[i].td = 0;
                continue;
            }
            klines[i].td = this.singleTd(klines[i], klines[i - 4], klines[i - 1].td);
        }
    }

    calcKlineBias(klines, mlen) {
        for (var i = 0; i < klines.length; ++i) {
            var ma = klines[i]['ma' + mlen];
            if (!ma) {
                ma = this.getNextKlMA(klines.slice(0, i), klines[i], mlen);
            }
            klines[i]['bias' + mlen] = (klines[i].c - ma) * 100 / ma;
        }
    }

    calcKlineMV(klines, mlen) {
        var len = 0;
        var sum = 0;
        for (var i = 0; i < klines.length; i++) {
            sum += parseFloat(klines[i].v);
            if (len < mlen) {
                len ++;
            } else {
                if (i >= mlen) {
                    sum -= klines[i - mlen].v;
                }
            }
            klines[i]['ma' + mlen] = (sum / len).toFixed(3);
        }
    }

    getNextKlMA(klines, kl, len) {
        var ma = parseFloat(kl.c);
        if (klines.length < len - 1) {
            for (var i = 0; i < klines.length; i++) {
                ma += parseFloat(klines[i].c);
            };
            return ma / (klines.length + 1);
        };
        for (var i = klines.length - len + 1; i < klines.length; i++) {
            ma += parseFloat(klines[i].c);
        };
        return ma / len;
    }

    getNextKlMV(klines, kl, len) {
        var mv = parseInt(kl.v);
        if (klines.length < len - 1) {
            for (var i = 0; i < klines.length; i++) {
                mv += parseInt(klines[i].v);
            }
            return mv / (klines.length + 1);
        }
        for (var i = klines.length - len + 1; i < klines.length; i++) {
            mv += parseInt(klines[i].v);
        }
        return mv / len;
    }

    klineApproximatelyAboveMa(klines, kl, mlen) {
        var ma = kl['ma' + mlen];
        if (!ma) {
            ma = this.getNextKlMA(klines, kl, mlen);
        }
        if (kl.l - ma > 0) {
            return true;
        };

        if (Math.min(kl.o, kl.c) - ma > 0 && (kl.h - kl.l) * 0.8 <= Math.abs(kl.o - kl.c)) {
            return true;
        };
        return false;
    }

    klineApproximatelyBellowMa(klines, kl, mlen) {
        var ma = kl['ma' + mlen];
        if (!ma) {
            ma = this.getNextKlMA(klines, kl, mlen);
        }
        if (kl.h - ma < 0) {
            return true;
        };

        if (Math.max(kl.o, kl.c) - ma < 0 && (kl.h - kl.l) * 0.8 <= Math.abs(kl.o - kl.c)) {
            return true;
        };
        return false;
    }

    getNextKlBss(klines, klnew, mlen) {
        var bss = 'u';
        var klpre = klines[klines.length - 1];
        var ma = klnew['ma' + mlen];
        if (!ma) {
            ma = this.getNextKlMA(klines, klnew, mlen);
        }
        var vbss = 'bss' + mlen;
        if (klnew.l - ma > 0 && this.klineApproximatelyAboveMa(klines.slice(0, klines.length - 1), klpre, mlen)) {
            if (klpre[vbss] == 'u') {
                bss = 'b';
            } else {
                bss = klpre[vbss] == 'w' ? 'b' : 'h';
            };
        } else if (klnew.h - ma < 0 && this.klineApproximatelyBellowMa(klines.slice(0, klines.length - 1), klpre, mlen)) {
            if (klpre[vbss] == 'u') {
                bss = 's';
            } else {
                bss = klpre[vbss] == 'h' ? 's' : 'w';
            };
        } else {
            bss = klpre[vbss];
            if (klpre[vbss] == 'b') {
                bss = 'h';
            } else if (klpre[vbss] == 's') {
                bss = 'w';
            };
        };
        return bss;
    }

    getNextKlTd(klines, kl) {
        if (klines.length < 4) {
            return 0;
        }

        var td = klines[klines.length - 1].td;
        var k4 = klines[klines.length - 4];
        return this.singleTd(kl, k4, td);
    }

    getNextKlBias(klines, kl, mlen) {
        var ma = kl['ma' + mlen];
        if (!ma) {
            ma = this.getNextKlMA(klines, kl, mlen);
        }
        return (kl.c - ma) * 100 / ma;
    }

    calcIncompleteKlineMA() {
        for (var kltype in this.incompleteKline) {
            var kl = this.incompleteKline[kltype];
            if (!kl) {
                continue;
            };
            var klines = this.klines[kltype];
            this.klvars.forEach(x => {
                if (x.startsWith('ma')) {
                    this.incompleteKline[kltype][x] = this.getNextKlMA(klines, kl, parseInt(x.substring(2)));
                } else if (x.startsWith('bss')) {
                    if (!klines || klines.length < 1) {
                        this.incompleteKline[kltype][x] = 'u';
                    } else {
                        this.incompleteKline[kltype][x] = this.getNextKlBss(klines, kl, parseInt(x.substring(3)));
                    }
                } else if (x == 'td') {
                    this.incompleteKline[kltype].td = this.getNextKlTd(klines, kl);
                } else if (x.startsWith('bias')) {
                    this.incompleteKline[kltype][x] = this.getNextKlBias(klines, kl, parseInt(x.substring(4)));
                } else {
                    if (x != 'prc' && x != 'pc') {
                        console.warn('Unknown klvar:', x);
                    }
                }
            });
        };
    }

    appendKlines(klines, fecthed) {
        var lastTime = klines[klines.length - 1].time;
        for (var i = 0; i < fecthed.length; ++i) {
            if (fecthed[i].time > lastTime) {
                this.appendCalcedKline(klines, fecthed[i]);
            }
        }
    }

    appendCalcedKline(klines, kl) {
        this.klvars.forEach(x => {
            if (x.startsWith('ma')) {
                kl[x] = this.getNextKlMA(klines, kl, parseInt(x.substring(2)));
            } else if (x.startsWith('bss')) {
                kl[x] = this.getNextKlBss(klines, kl, parseInt(x.substring(3)));
            } else if (x == 'td') {
                kl.td = this.getNextKlTd(klines, kl);
            } else if (x.startsWith('bias')) {
                kl[x] = this.getNextKlBias(klines, kl, parseInt(x.substring(4)))
            } else {
                if (x != 'prc' && x != 'pc') {
                    console.warn('Unknown klvar:', x);
                }
            }
        });
        klines.push(kl);
    }

    updateRtKline(message) {
        var kltype = message.kltype;
        var stime = '0';
        if (this.klines && this.klines[kltype] && this.klines[kltype].length > 0) {
            stime = this.klines[kltype][this.klines[kltype].length - 1].time;
        };
        var klines = this.parseKlines(message.kdata, stime, kltype);
        var updatedKlt = [];
        if (this.getIncompleteKline(kltype) || klines.length > 0) {
            updatedKlt.push(kltype);
        }
        if (!this.klines) {
            this.klines = {};
        };
        if (this.klines[kltype] === undefined || this.klines[kltype].length == 0) {
            this.klines[kltype] = klines;
            this.calcAllKlineVars(this.klines[kltype]);
        } else {
            this.appendKlines(this.klines[kltype], klines);
        };
        if (this.baseKlt.has(kltype)) {
            this.factors.forEach(f => {
                if (this.fillUpKlinesBaseOn(kltype, f)) {
                    updatedKlt.push((kltype * f).toString());
                };
            });
        };
        this.calcIncompleteKlineMA();
        return updatedKlt;
    }

    getFactoredKlines(kltype, fac, stime = '0') {
        var klines = this.klines[kltype];
        var fklines = [];
        var startIdx = 0;
        if (stime) {
            for (; startIdx < klines.length; startIdx++) {
                if (klines[startIdx].time > stime) {
                    break;
                };
            };
        };

        var inkl = this.getIncompleteKline(kltype);
        this.incompleteKline[kltype * fac] = null;
        for (var i = startIdx; i < klines.length; i += fac) {
            var o = klines[i].o;
            var c = 0;
            var time = klines[i].time;
            var h = klines[i].h;
            var l = klines[i].l;
            var v = 0;
            if (klines.length - i >= fac) {
                c = klines[i + fac - 1].c;
                time = klines[i + fac - 1].time;
                for (var j = 0; j < fac; j++) {
                    v -= klines[i + j].v;
                    if (klines[i + j].h - h > 0) {
                        h = klines[i + j].h;
                    };
                    if (klines[i + j].l - l < 0) {
                        l = klines[i + j].l;
                    };
                };
                if (v < 0) {
                    v = -v;
                };
                fklines.push({time, o, c, h, l, v});
            } else if (klines.length - i + 1 == fac && inkl) {
                time = inkl.time;
                c = inkl.c;
                h = inkl.h;
                l = inkl.l;
                v -= inkl.v;
                for (var j = i; j < klines.length; ++j) {
                    v -= klines[j].v;
                    if (klines[j].h - h > 0) {
                        h = klines[j].h;
                    };
                    if (klines[j].l - l < 0) {
                        l = klines[j].l;
                    };
                };
                if (v < 0) {
                    v = -v;
                };
                this.incompleteKline[kltype * fac] = {time, o, c, h, l, v};
            };
        };
        return fklines;
    }

    fillUpKlinesBaseOn(kltype, fac) {
        if (this.klines[kltype] === undefined || this.klines[kltype].length < fac - 1) {
            return false;
        };

        if (this.klines[kltype].length == fac - 1 && !this.getIncompleteKline(kltype)) {
            return false;
        };

        var fklt = kltype * fac;
        if (this.klines[fklt] === undefined || this.klines[fklt].length == 0) {
            var fklines = this.getFactoredKlines(kltype, fac);
            this.klines[fklt] = fklines;
            this.calcAllKlineVars(this.klines[fklt]);
            return fklines.length > 0 || Boolean(this.getIncompleteKline(fklt));
        } else {
            var stime = this.klines[fklt][this.klines[fklt].length - 1].time;
            var fklines = this.getFactoredKlines(kltype, fac, stime);
            this.appendKlines(this.klines[fklt], fklines);
            return fklines.length > 1 || Boolean(this.getIncompleteKline(fklt));
        };
    }

    getLastPeak(kltype='101') {
        // 获取最新的波峰
        var inkl = this.getIncompleteKline(kltype);
        if (!this.klines || !this.klines[kltype] || this.klines[kltype].length == 0) {
            return inkl ? inkl.h : 0;
        }

        var kline = this.klines[kltype];
        var lidx = kline.length - 1;
        var lastkl = inkl;
        if (!inkl) {
            lastkl = kline[lidx];
            lidx--;
        }

        var stopl = lastkl.l;
        var peak = lastkl.h;
        while (lidx >= 0) {
            var prekl = kline[lidx];
            if (prekl.h - peak > 0) {
                peak = prekl.h;
            }
            if (prekl.l - stopl <= 0) {
                break;
            }
            lidx--;
        }
        return peak;
    }

    getLastTrough(kltype) {
        if (!this.klines || !this.klines[kltype]) {
            console.log('no klins data for kltype', kltype);
            return 0;
        }

        var nKlines = this.klines[kltype];
        if (nKlines && nKlines.length > 0) {
            var downKlNum = 0;
            var upKlNum = 0;
            var troughprice = nKlines[nKlines.length - 1].l;
            for (let i = nKlines.length - 1; i > 0; i--) {
                const kl = nKlines[i];
                const kl0 = nKlines[i - 1];
                if (downKlNum < 2) {
                    if (kl.l - kl0.l < 0) {
                        continue;
                    }
                    if (kl.l - kl0.l > 0) {
                        downKlNum++;
                        troughprice = kl0.l;
                    }
                } else {
                    if (kl.l - kl0.l > 0) {
                        if (upKlNum >= 2) {
                            break;
                        }
                        if (troughprice - kl0.l > 0) {
                            downKlNum++;
                            troughprice = kl0.l;
                        }
                        upKlNum = 0;
                        continue;
                    }
                    if (kl.l - kl0.l < 0) {
                        upKlNum++;
                    }
                }
            }
            if (upKlNum >= 2 && downKlNum > 2) {
                return troughprice;
            }
        }
        return 0;
    }

    isLowPriceStopIncreasing(kltype='101') {
        // 低点不再增加
        if (!this.klines || !this.klines[kltype] || this.klines[kltype].length == 0) {
            return false;
        }

        var inkl = this.getIncompleteKline(kltype);
        var kline = this.klines[kltype];
        var lidx = kline.length - 1;
        if (inkl) {
            return inkl.l - kline[lidx].l < 0;
        }
        if (kline.length < 2) {
            return false;
        }
        return kline[lidx].l - kline[lidx - 1].l < 0;
    }

    isDecreaseStoppedStrict(kltype) {
        // 严格止跌，下降趋势>8根K线，反弹连续2根K线的收盘价和最低价均上涨，主要用于建仓或者做正T
        if (!this.klines || !this.klines[kltype] || this.klines[kltype].length < 10) {
            console.log('no klins data for kltype', kltype);
            return false;
        }

        var kline = this.getKline(kltype);
        var lastIdx = kline.length - 1;
        var klend = this.getIncompleteKline(kltype);
        if (!klend) {
            klend = kline[lastIdx];
            lastIdx = kline.length - 2;
        }

        // 最低点
        var bottomIdx = lastIdx;
        var bottomPrc = klend.l;
        for (let i = lastIdx; i >= 0 && i > lastIdx - 10; i--) {
            const klpre = kline[i];
            if (klpre.l - bottomPrc < 0) {
                bottomPrc = klpre.l;
                bottomIdx = i;
            }
        }

        // 最低点之前下跌k线数
        var klbottom = kline[bottomIdx];
        var decCount = 0;
        var ndecCt = 0;
        for (let i = bottomIdx - 1; i >= 0; i--) {
            const klpre = kline[i];
            if (klpre.h - klbottom.h > 0 || klpre.c - klbottom.c > 0) {
                decCount++;
                if (ndecCt > 0) {
                    ndecCt = 0;
                }
                klbottom = kline[i];
            } else {
                ndecCt++;
            }
            if (ndecCt > 2) {
                return false;
            }
            if (decCount >= 8) {
                break;
            }
        }

        if (ndecCt > 2 || decCount < 8) {
            return false;
        }

        if (lastIdx > bottomIdx + 5) {
            return false;
        }
        // 低点之后上涨k线数
        var upCount = 0;
        for (let i = lastIdx; i >= 0 && i >= bottomIdx; i--) {
            const klpre = kline[i];
            if (klend.c - klpre.c > 0 && klend.l - klpre.l > 0) {
                upCount++;
                if (upCount >= 2) {
                    return true;
                }
                klend = klpre;
                continue;
            } else {
                return upCount >= 2;
            }
        }
        return upCount >= 2;
    }

    getLowestInWaiting(kltype) {
        if (!this.klines || !this.klines[kltype]) {
            console.log('no klins data for kltype', kltype);
            return 0;
        }

        var nKlines = this.klines[kltype];
        var hcount = 0;
        if (nKlines && nKlines.length > 0) {
            var low = nKlines[nKlines.length - 1].l;
            for (let i = nKlines.length - 1; i > 0; i--) {
                const kl = nKlines[i];
                if (kl.bss18 == 'h') {
                    hcount++
                    if (hcount > 3) {
                        break;
                    }
                }
                if (kl.l - low < 0) {
                    low = kl.l;
                }
            }
            return low;
        }
        return 0;
    }

    getMinVolBefore(t, n, kltype='101') {
        // 获取t日之前n天的最小成交量
        if (!this.klines || !this.klines[kltype] || this.klines[kltype].length == 0) {
            return 0;
        }

        var inkl = this.getIncompleteKline(kltype);
        var mVol = 0;
        var m = 0;
        if (inkl && inkl.time <= t) {
            mVol = inkl.v;
            m = 1;
        }
        var kline = this.klines[kltype];
        for (var i = kline.length - 1; i >= 0; i--) {
            if (kline[i].time > t) {
                continue;
            }
            if (mVol == 0 || mVol - kline[i].v > 0) {
                mVol = kline[i].v;
            }
            m++;
            if (m >= n) {
                break;
            }
        }
        return mVol;
    }

    minVolKlSince(t, kltype='101') {
        // 获取t日之后成交量最小的k线
        var inkl = this.getIncompleteKline(kltype);
        if (!this.klines || !this.klines[kltype] || this.klines[kltype].length == 0) {
            if (inkl && inkl.time >= t) {
                return inkl;
            }
            return;
        }

        var kline = this.klines[kltype];
        var lidx = kline.length - 1;
        var mVol = kline[kline.length - 1].v;
        var kl = kline[kline.length - 1];
        if (inkl && inkl.time >= t) {
            lidx--;
            mVol = inkl.v;
            kl = inkl;
        }
        for (var i = lidx; i >= 0; i--) {
            if (kline[i].time <= t) {
                break;
            }
            if (kline[i].v - mVol < 0) {
                mVol = kline[i].v;
                kl = kline[i];
            }
        }
        return kl;
    }

    getVolScale(kltype, time, n) {
        // get v scale for time based on mvol(n)
        var kline = this.klines[kltype];
        var tidx = kline.findIndex(kl => kl.time == time);
        if (tidx < 1) {
            console.log('error: no kline for code = ', this.code, ' time=', time);
            return 1;
        }
        var totalVol = 0;
        for (var i = 1; i <= n; i++) {
            if (tidx - i < 0) {
                break;
            }
            totalVol -= kline[tidx - i].v;
        }
        if (totalVol < 0) {
            totalVol = - totalVol;
        }
        var va = totalVol / n;
        if (tidx < n) {
            va = totalVol / tidx;
        }
        return kline[tidx].v / va;
    }

    getZtStrength(time) {
        var kline = this.klines['101'];
        var tidx = kline.findIndex(kl => kl.time == time);
        if (tidx < 1) {
            console.log('error: no kline data to check zt strength', this.code, time);
            return;
        }
        var delta = kline[tidx].c - kline[tidx].l;
        if (delta == 0) {
            return 0;
        }
        var lc = kline[tidx - 1].c;
        return (100 * delta / lc).toFixed(2);
    }

    getCutPrice(time) {
        var kline = this.klines['101'];
        var tidx = kline.findIndex(kl => kl.time == time);
        if (tidx < 0) {
            console.log('error: no kline data to check cut price', this.code, time);
            return;
        }
        var c = kline[tidx].c * 0.9;
        return c - kline[tidx].l > 0 ? kline[tidx].l : c.toFixed(2);
    }

    continuouslyIncreaseDays(kltype='101') {
        // 止跌，连续2根K线收盘价上涨。主要用于网格法加仓买入，有价格区间限制
        if (!this.klines || !this.klines[kltype]) {
            return 0;
        }
        var kline = this.klines[kltype];
        var n = 0;
        var lidx = kline.length - 1;
        var kl = this.getIncompleteKline(kltype);
        if (!kl) {
            kl = kline[lidx];
            lidx--;
        }
        for (var i = lidx; i >= 0; i--) {
            if (kline[i].c - kl.c > 0) {
                break;
            }
            if (kline[i].c - kl.c == 0) {
                continue;
            }
            n++;
        }
        return n;
    }

    continuouslyZtDays() {
        // 连续涨停天数
        var kltype = '101';
        if (!this.klines || !this.klines[kltype]) {
            return 0;
        }

        var kline = this.klines[kltype];
        var n = 0;
        var lidx = kline.length - 1;
        var kl = this.getIncompleteKline(kltype);
        if (!kl) {
            kl = kline[lidx];
            lidx--;
        }
        for (var i = lidx; i >= 0; i--) {
            if (kl.h - kl.c > 0) {
                break;
            }
            if (kline[i].c * 1.09 - kl.c > 0) {
                break;
            }
            n++;
        }
        return n;
    }

    continuouslyDecreaseDays(kltype='101') {
        if (!this.klines || !this.klines[kltype]) {
            return 0;
        }
        var kline = this.klines[kltype];
        var n = 0;
        var lidx = kline.length - 1;
        var kl = this.getIncompleteKline(kltype);
        if (!kl) {
            kl = kline[lidx];
            lidx--;
        }
        for (var i = lidx; i >= 0; i--) {
            if (kline[i].c - kl.c < 0) {
                break;
            }
            if (kline[i].c - kl.c == 0) {
                continue;
            }
            n++;
        }
        return n;
    }

    continuouslyDtDays(yz=false) {
        const kltype = '101';
        if (!this.klines || !this.klines[kltype] || this.klines[kltype].length == 0) {
            return 0;
        }

        var n = 0;
        for (let i = this.klines[kltype].length - 1; i > 0; i--) {
            let kl = this.klines[kltype][i];
            let klpre = this.klines[kltype][i-1];
            if (yz && kl.h - kl.l > 0) {
                break;
            }
            if (kl.c - feng.getStockDt(this.code, klpre.c) <= 0) {
                n += 1;
            }
        }
        return n;
    }

    continuouslyBellowMaDays(kltype='101') {
        if (!this.klines || !this.klines[kltype] || this.klines[kltype].length == 0) {
            return 0;
        }
        var kline = this.klines[kltype];
        var n = 0;
        for (var i = kline.length - 1; i > 0; i--) {
            var kl = kline[i];
            if (kl.bss18 != 'w' && kl.bss18 != 's') {
                break;
            }
            if (kl.ma18 - kl.o < 0 || kl.ma18 - kl.c < 0) {
                return n;
            }
            n++;
        }
        return n;
    }

    continuouslyBellowPrcDays(prc, kltype = '101') {
        if (!this.klines) {
            return 0;
        }
        var kline = this.klines[kltype];
        var n = 0;
        var inkl = this.getIncompleteKline(kltype);
        if (inkl) {
            if (inkl.h - prc < 0) {
                n ++;
            } else {
                return 0;
            }
        }
        for (var i = kline.length - 1; i > 0; i--) {
            var kl = kline[i];
            if (prc - kl.h < 0) {
                return n;
            }
            n++;
        }
        return n;
    }

    KlineNumSince(date, kltype = '101') {
        if (!this.klines) {
            return 0;
        }

        var klNum = 0;
        var inkl = this.getIncompleteKline(kltype);
        if (inkl && inkl.time > date) {
            klNum ++;
        }

        var kline = this.klines[kltype];
        for (var i = kline.length - 1; i >= 0; i--) {
            if (kline[i].time <= date) {
                break;
            }
            klNum ++;
        }
        return klNum;
    }

    everRunAboveSince(date, price, kltype='101') {
        // 从date开始的k线是否存在最大值>=price
        if (!this.klines || !this.klines[kltype]) {
            return false;
        }
        var inkl = this.getIncompleteKline(kltype);
        if (inkl && inkl.time > date && inkl.h - price >= 0) {
            return true
        }
        var kline = this.klines[kltype];
        for (var i = kline.length - 1; i >= 0; i--) {
            if (kline[i].time < date) {
                break;
            }
            if (kline[i].h - price >= 0) {
                return true;
            }
        }
        return false;
    }

    highestPriceSince(date, kltype='101') {
        // date(不含)之后最高价
        var inkl = this.getIncompleteKline(kltype);
        if (!this.klines || !this.klines[kltype] || this.klines[kltype].length == 0) {
            if (inkl && inkl.time >= date) {
                return inkl.h;
            }
            return 0;
        }

        var kline = this.klines[kltype];
        var hprc = kline[kline.length - 1].h;
        var lidx = kline.length - 2;
        if (inkl)  {
            hprc = inkl.h;
            lidx = kline.length - 1;
        }

        for (var i = lidx; i >= 0; i--) {
            var kl = kline[i];
            if (kl.time <= date) {
                break;
            }
            if (kl.h - hprc > 0) {
                hprc = kl.h;
            }
        }
        return hprc;
    }

    lowestPriceSince(date, kltype = '101') {
        // date(不含)之后最低价
        var inkl = this.getIncompleteKline(kltype);
        if (!this.klines || !this.klines[kltype] || this.klines[kltype].length == 0) {
            if (inkl && inkl.time >= date) {
                return inkl.l;
            }
            return 0;
        }

        var kline = this.klines[kltype];
        var lprc = kline[kline.length - 1].l;
        var lidx = kline.length - 2;
        if (inkl) {
            lprc = inkl.l;
            lidx = kline.length - 1;
        }

        for (let i = lidx; i >= 0; i--) {
            const kl = kline[i];
            if (kl.time <= date) {
                break;
            }
            if (kl.l - lprc < 0) {
                lprc = kl.l;
            }
        }
        return lprc;
    }

    lowestKlSince(date, kltype = '101') {
        // 返回最小值所在的k线数据
        if (!this.klines) {
            return;
        }

        var kline = this.klines[kltype];
        var inkl = this.getIncompleteKline(kltype);
        if (kline.length == 0) {
            return inkl;
        }

        var lprc = kline[kline.length - 1].l;
        var lidx = kline.length - 1;
        for (let i = kline.length - 2; i >= 0; i--) {
            const kl = kline[i];
            if (kl.time <= date) {
                break;
            }
            if (kl.l - lprc < 0) {
                lprc = kl.l;
                lidx = i;
            }
        }

        if (!inkl) {
            return kline[lidx];
        }

        return kline[lidx].l - inkl.l > 0 ? inkl : kline[lidx];
    }

    bottomRegionDays(kltype='101') {
        // 低位横盘k线数
        // 查找最近最低点，且当前价在最低点30%区间内
        if (!this.klines || !this.klines[kltype]) {
            return 0;
        }

        var kline = this.klines[kltype];
        var latestPrice = this.getLatestKline(kltype).c;
        var lowPrice = kline[kline.length - 1].l;
        var lowId = kline.length - 1;
        // 查找最新100根k线的最小值
        for (var i = kline.length - 1; i >= 0 && i > kline.length - 100; i--) {
            if (kline[i].l - lowPrice < 0) {
                lowPrice = kline[i].l;
                lowId = i;
            }
        }
        if (lowPrice * 1.15 - latestPrice < 0) {
            // 最新价 > 1.2 * 最低价
            return 0;
        }
        var bigCount = 0;
        var hCount = kline.length - lowId - 1;
        for (var i = lowId; i < kline.length; ++i) {
            if (kline[i].c - lowPrice * 1.3 > 0) {
                bigCount++;
            }
        }
        if (bigCount > hCount * 0.1) {
            return 0;
        }
        return hCount;
    }

    isWaitingBss(kltype='101', mlen=18) {
        if (!this.klines || !this.klines[kltype]) {
            return false;
        }

        var kl = this.getLatestKline(kltype);
        var kline = this.klines[kltype];
        if (kl['bss' + mlen] === undefined) {
            this.calcKlineBss(kline, mlen);
        }

        return kline[kline.length - 1]['bss' + mlen] == 'w';
    }

    getLastBssBuyKline(kltype='101', mlen=18) {
        if (!this.klines || !this.klines[kltype] || this.klines[kltype].length == 0) {
            return;
        }

        var kline = this.klines[kltype];
        var inkl = this.getIncompleteKline(kltype);
        var lastIdx = inkl ? kline.length - 1 : kline.length - 2;
        for (var i = lastIdx; i >= 0; i--) {
            if (kline[i]['bss' + mlen] === undefined) {
                this.calcKlineBss(kline, mlen);
            }
            if (kline[i]['bss' + mlen] == 'b') {
                return kline[i];
            }
        }
    }

    lastDownKl(upBound, kltype='101') {
        return this.lastDownKlBetween(upBound, undefined, kltype);
    }

    lastDownKlBetween(upBound, lowBound, kltype='101') {
        // 最新k线之前一次跌幅介于upBound, lowBound之间的k线
        if (!this.klines || !this.klines[kltype]) {
            return;
        }
        var kline = this.klines[kltype];
        var lidx = kline.length - 1;
        var inkl = this.getIncompleteKline(kltype);
        if (!inkl && kline.length > 1) {
            lidx--;
        }

        while(lidx >= 0) {
            var kl = kline[lidx];
            var lc = kl.o;
            var preId = lidx - 1;
            if (preId >= 0) {
                lc = kline[lidx - 1].c;
            }

            var pct = (kl.c - lc) / lc;
            if (pct - upBound <= 0 && (lowBound === undefined || pct - lowBound >= 0)) {
                return kl;
            }
            lidx --;
        }

        return;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {klPad, KLine}
} else if (typeof window !== 'undefined') {
    window.klPad = klPad;
    window.KLine = KLine;
}
})();
