
const fs = require("fs");
const expect = require("chai").expect;
const Queue = require("../").Queue;

function getAsyncTask(counter) {
    var active = 0;
    if (!counter) {
        counter = {
            scheduled: 0,
        };
    }
    return function(callback) {
        var index = counter.scheduled;
        counter.scheduled += 1;
        active += 1;
        process.nextTick(function() {
            try {
                callback(null, {
                    active: active,
                    index: index,
                });
            } finally {
                active -= 1;
            }
        });
    };
}

function getDeferredSyncTask(counter) {
    var active = 0, deferrals = [];
    if(!counter) {
        counter = {scheduled: 0};
    }
    function task(callback) {
        if(deferrals) {
            return deferrals.push({callback: callback, index: counter.scheduled++});
        }
        try {
            callback(null, {active: ++active, index: counter.scheduled++});
        } finally {
            debugger;
            active -= 1;
        }
    }
    task.finish = function() {
        var deferrals_ = deferrals.slice();
        deferrals = null;
        deferrals_.forEach(function(deferral) {
            try {
                deferral.callback(null, {active: ++active, index: deferral.index});
            } finally {
                active -= 1;
            }
        });
    };
    return task;
};

function getSyncTask(counter) {
    var active = 0;
    if(!counter) {
        counter = {scheduled: 0};
    }
    return function(callback) {
        try {
            callback(null, {
                active: ++active, 
                index: counter.scheduled++,
            });
        } finally {
            active -= 1;
        }
    };
};

describe("Queue", function() {

    it("example queue of fs.stat", function(done) {
        new Queue()
            .add(fs.stat, __dirname + "/../LICENSE")
            .add(fs.stat, __dirname + "/../README.md")
            .add(fs.stat, __dirname + "/../package.json")
            .await(function callback(results) {
                expect(results).to.have.lengthOf(3);
                var errors = results.filter(function(result) { return result.isError; });
                expect(errors).to.have.lengthOf(0);
                expect(results[0].data.size).to.be.above(0);
                expect(results[1].data.size).to.be.above(0);
                expect(results[2].data.size).to.be.above(0);
                done();
            });
    });

    it("if the concurrency is invalid, an Error is thrown", function() {
        expect(function() { new Queue(NaN); }).to.throw();
        expect(function() { new Queue(0); }).to.throw();
        expect(function() { new Queue(-1); }).to.throw();
    });

    it("queue.add throws an error if passed a non-function", function() {
        expect(function() { new Queue().add(42); }).to.throw();
    });

    it("queue.await throws an error if passed a non-function", function() {
        expect(function() { new Queue().add(getAsyncTask()).await(42); }).to.throw();
    });

    it("in a queue of a single synchronous task that errors, the error is returned", function() {
        new Queue()
            .add(function(callback) { callback(-1); })
            .await(function(results) {
                expect(results).to.have.lengthOf(1);
                expect(results[0].isError).to.be.true;
                expect(results[0].data).to.equal(-1);
            });
    });

    it("in a queue of a single asynchronous task that errors, the error is returned", function(done) {
        new Queue()
            .add(function(callback) { process.nextTick(function() { callback(-1); }); })
            .await(function(results) {
                expect(results).to.have.lengthOf(1);
                expect(results[0].isError).to.be.true;
                expect(results[0].data).to.equal(-1);
                done();
            });
    });

    it("in a queue with multiple tasks that error, all errors are returned in the same order as the tasks", function(done) {
        new Queue()
            .add(function(callback) { setTimeout(function() { callback(-1); }, 100); })
            .add(function(callback) { process.nextTick(function() { callback(-2); }); })
            .add(function(callback) { setTimeout(function() { callback(-3); }, 200); })
            .await(function(results) {
                expect(results).to.have.lengthOf(3);
                var errors = results.filter(function(result) { return result.isError; });
                expect(errors).to.have.lengthOf(3);
                expect(results[0].data).to.equal(-1);
                expect(results[1].data).to.equal(-2);
                expect(results[2].data).to.equal(-3);
                done();
            });
    });

    it("in a queue with multiple tasks where one errors, the rest of the tasks are still executed", function(done) {
        new Queue()
            .add(function(callback) { setTimeout(function() { callback(-1); }, 100); })
            .add(function(callback) { process.nextTick(function() { callback(null, -2); }); })
            .add(function(callback) { setTimeout(function() { callback(null, -3); }, 200); })
            .await(function(results) {
                expect(results).to.have.lengthOf(3);
                expect(results[0].isError).to.be.true;
                expect(results[0].data).to.equal(-1);
                expect(results[1].isError).to.be.false;
                expect(results[1].data).to.equal(-2);
                expect(results[2].isError).to.be.false;
                expect(results[2].data).to.equal(-3);
                done();
            });
    });

    it("in a queue with a task that throws an error synchronously, the error is reported to the await callback", function() {
        new Queue()
            .add(function(callback) { throw new Error("foo"); })
            .await(function(results) {
                expect(results).to.have.lengthOf(1);
                expect(results[0].isError).to.be.true;
                expect(results[0].data.message).to.equal("foo");
            });
    });

    it("in a queue with a task that throws an error after calling back, the error is ignored", function(done) {
        new Queue()
            .add(function(callback) { setTimeout(function() { callback(null, 1); }, 100); })
            .add(function(callback) { callback(null, 2); process.nextTick(function() { callback(new Error("foo")); }); })
            .await(function(results) {
                expect(results).to.have.lengthOf(2);
                var errors = results.filter(function(result) { return result.isError; });
                expect(errors).to.have.lengthOf(0);
                done();
            });
    });

    it("a serial queue of asynchronous closures processes tasks serially", function(done) {
        var tasks = [],
            asyncTask = getAsyncTask(),
            n = 10,
            queue = new Queue(1);
        while (--n >= 0) tasks.push(asyncTask);
        tasks.forEach(function(task) { queue.add(task); });
        queue.await(function callback(results) {
            expect(results).to.deep.equal([
                {isError: false, data: {active: 1, index: 0}},
                {isError: false, data: {active: 1, index: 1}},
                {isError: false, data: {active: 1, index: 2}},
                {isError: false, data: {active: 1, index: 3}},
                {isError: false, data: {active: 1, index: 4}},
                {isError: false, data: {active: 1, index: 5}},
                {isError: false, data: {active: 1, index: 6}},
                {isError: false, data: {active: 1, index: 7}},
                {isError: false, data: {active: 1, index: 8}},
                {isError: false, data: {active: 1, index: 9}},
            ]);
            done();
        });
    });

    it("a fully-concurrent queue of ten asynchronous tasks executes all tasks concurrently", function(done) {
        var asyncTask = getAsyncTask();
        new Queue()
            .add(asyncTask)
            .add(asyncTask)
            .add(asyncTask)
            .add(asyncTask)
            .add(asyncTask)
            .add(asyncTask)
            .add(asyncTask)
            .add(asyncTask)
            .add(asyncTask)
            .add(asyncTask)
            .await(function(results) {
                expect(results).to.deep.equal([
                    {isError: false, data: {active: 10, index: 0}},
                    {isError: false, data: {active: 9, index: 1}},
                    {isError: false, data: {active: 8, index: 2}},
                    {isError: false, data: {active: 7, index: 3}},
                    {isError: false, data: {active: 6, index: 4}},
                    {isError: false, data: {active: 5, index: 5}},
                    {isError: false, data: {active: 4, index: 6}},
                    {isError: false, data: {active: 3, index: 7}},
                    {isError: false, data: {active: 2, index: 8}},
                    {isError: false, data: {active: 1, index: 9}},
                ]);
                done();
            });
    });

    it("a partly-concurrent queue of ten asynchronous tasks executes at most three tasks concurrently", function(done) {
        var asyncTask = getAsyncTask();
        new Queue(3)
            .add(asyncTask)
            .add(asyncTask)
            .add(asyncTask)
            .add(asyncTask)
            .add(asyncTask)
            .add(asyncTask)
            .add(asyncTask)
            .add(asyncTask)
            .add(asyncTask)
            .add(asyncTask)
            .await(function(results) {
                expect(results).to.deep.equal([
                    {isError: false, data: {active: 3, index: 0}},
                    {isError: false, data: {active: 3, index: 1}},
                    {isError: false, data: {active: 3, index: 2}},
                    {isError: false, data: {active: 3, index: 3}},
                    {isError: false, data: {active: 3, index: 4}},
                    {isError: false, data: {active: 3, index: 5}},
                    {isError: false, data: {active: 3, index: 6}},
                    {isError: false, data: {active: 3, index: 7}},
                    {isError: false, data: {active: 2, index: 8}},
                    {isError: false, data: {active: 1, index: 9}},
                ]);
                done();
            });
    });

    it("a serialized queue of ten asynchronous tasks executes all tasks in series", function(done) {
        var asyncTask = getAsyncTask();
        new Queue(1)
            .add(asyncTask)
            .add(asyncTask)
            .add(asyncTask)
            .add(asyncTask)
            .add(asyncTask)
            .add(asyncTask)
            .add(asyncTask)
            .add(asyncTask)
            .add(asyncTask)
            .add(asyncTask)
            .await(function(results) {
                expect(results).to.deep.equal([
                    {isError: false, data: {active: 1, index: 0}},
                    {isError: false, data: {active: 1, index: 1}},
                    {isError: false, data: {active: 1, index: 2}},
                    {isError: false, data: {active: 1, index: 3}},
                    {isError: false, data: {active: 1, index: 4}},
                    {isError: false, data: {active: 1, index: 5}},
                    {isError: false, data: {active: 1, index: 6}},
                    {isError: false, data: {active: 1, index: 7}},
                    {isError: false, data: {active: 1, index: 8}},
                    {isError: false, data: {active: 1, index: 9}},
                ]);
                done();
            });
    });

    it("a partly-concurrent queue of ten synchronous tasks executes all tasks in series", function(done) {
        var syncTask = getSyncTask();
        new Queue(3)
            .add(syncTask)
            .add(syncTask)
            .add(syncTask)
            .add(syncTask)
            .add(syncTask)
            .add(syncTask)
            .add(syncTask)
            .add(syncTask)
            .add(syncTask)
            .add(syncTask)
            .await(function(results) {
                expect(results).to.deep.equal([
                    {isError: false, data: {active: 1, index: 0}},
                    {isError: false, data: {active: 1, index: 1}},
                    {isError: false, data: {active: 1, index: 2}},
                    {isError: false, data: {active: 1, index: 3}},
                    {isError: false, data: {active: 1, index: 4}},
                    {isError: false, data: {active: 1, index: 5}},
                    {isError: false, data: {active: 1, index: 6}},
                    {isError: false, data: {active: 1, index: 7}},
                    {isError: false, data: {active: 1, index: 8}},
                    {isError: false, data: {active: 1, index: 9}},
                ]);
                done();
            });
    });

    it("a serialized queue of ten synchronous tasks executes all tasks in series", function(done) {
        var syncTask = getSyncTask();
        new Queue(1)
            .add(syncTask)
            .add(syncTask)
            .add(syncTask)
            .add(syncTask)
            .add(syncTask)
            .add(syncTask)
            .add(syncTask)
            .add(syncTask)
            .add(syncTask)
            .add(syncTask)
            .await(function(results) {
                expect(results).to.deep.equal([
                    {isError: false, data: {active: 1, index: 0}},
                    {isError: false, data: {active: 1, index: 1}},
                    {isError: false, data: {active: 1, index: 2}},
                    {isError: false, data: {active: 1, index: 3}},
                    {isError: false, data: {active: 1, index: 4}},
                    {isError: false, data: {active: 1, index: 5}},
                    {isError: false, data: {active: 1, index: 6}},
                    {isError: false, data: {active: 1, index: 7}},
                    {isError: false, data: {active: 1, index: 8}},
                    {isError: false, data: {active: 1, index: 9}},
                ]);
                done();
            });
    });

    it("a huge queue of deferred synchronous tasks does not throw a RangeError", function(done) {
        var deferredSyncTask = getDeferredSyncTask(),
            queue = new Queue(),
            n = 200000;
        for (var i = 0; i < n; ++i) {
            queue.add(deferredSyncTask);
        }
        deferredSyncTask.finish();
        queue.await(function(results) {
            expect(results).to.have.lengthOf(n);
            var errors = results.filter(function(result) { return result.isError; });
            expect(errors).to.have.lengthOf(0);
            done();
        });
    });

    it("if a task calls back successfully more than once, subsequent calls are ignored", function(done) {
        new Queue()
            .add(function(callback) { setTimeout(function() { callback(null, 1); }, 100); })
            .add(function(callback) { callback(null, 2); process.nextTick(function() { callback(null, -1); }); })
            .add(function(callback) { callback(null, 3); process.nextTick(function() { callback(new Error("foo")); }); })
            .add(function(callback) { process.nextTick(function() { callback(null, 4); }); setTimeout(function() { callback(new Error("bar")); }, 100); })
            .await(function(results) {
                expect(results).to.have.lengthOf(4);
                var errors = results.filter(function(result) { return result.isError; });
                expect(errors).to.have.lengthOf(0);
                expect(results[0].data).to.equal(1);
                expect(results[1].data).to.equal(2);
                expect(results[2].data).to.equal(3);
                expect(results[3].data).to.equal(4);
                done();
            });
    });

    it("if a task calls back with an error more than once, subsequent calls are ignored", function(done) {
        new Queue()
            .add(function(callback) { setTimeout(function() { callback(null, 1); }, 100); })
            .add(function(callback) { callback(new Error("foo")); process.nextTick(function() { callback(new Error("bar")); }); })
            .add(function(callback) { process.nextTick(function() { callback(new Error("bar")); }); setTimeout(function() { callback(new Error("baz")); }, 100); })
            .await(function(results) {
                expect(results).to.have.lengthOf(3);
                expect(results[0].isError).to.be.false;
                expect(results[1].isError).to.be.true;
                expect(results[1].data.message).to.equal("foo");
                expect(results[2].isError).to.be.true;
                expect(results[2].data.message).to.equal("bar");
                done();
            });
    });

    it("if a task throws an error aftering calling back synchronously, the error is ignored", function() {
        new Queue()
            .add(function(callback) {
                callback(null, 1);
                throw new Error;
            })
            .await(function(results) {
                expect(results).to.deep.equal([{isError: false, data: 1}]);
            });
    });

    it("if the await callback throws an error aftering calling back synchronously, the error is thrown", function(done) {
        new Queue(1)
            .add(function(callback) { process.nextTick(callback); })
            .add(function(callback) { callback(null, 1); })
            .await(function() { throw new Error("foo"); });
        process.prependOnceListener("uncaughtException", function(error) {
            expect(error.message).to.equal("foo");
            done();
        });
    });

    it("if a task errors, another task can still complete successfully, and its return value is sent to the await callback", function(done) {
        new Queue()
            .add(function(callback) { setTimeout(function() { callback(null, 1); }, 10); })
            .add(function(callback) { callback(new Error("foo")); })
            .await(function callback(results) {
                expect(results).to.have.lengthOf(2);
                expect(results[0]).to.deep.equal({isError: false, data: 1});
                expect(results[1].isError).to.be.true;
                expect(results[1].data.message).to.equal("foo");
                done();
            });
    });

    it("a task that defers another task is allowed", function(done) {
        var queue = new Queue();
        queue.add(function(callback) {
            callback(null);
            queue.add(function(callback) {
                done();
            });
        });
    });

    it("a falsey error is still considered an error", function(done) {
        new Queue()
            .add(function(callback) { callback(0); })
            .add(function() { throw new Error; })
            .await(function(results) { 
                expect(results).to.have.lengthOf(2);
                var errors = results.filter(function(result) { return result.isError; });
                expect(errors).to.have.lengthOf(2);
                done(); 
            });
    });

});