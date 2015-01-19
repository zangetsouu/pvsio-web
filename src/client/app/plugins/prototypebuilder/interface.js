/**
 * Binds user interface elements to events
 * @author Patrick Oladimeji
 * @date 11/15/13 16:29:55 PM
 */
/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50, es5: true*/
/*global define, d3, $, Backbone, Handlebars, Promise, layoutjs */
define(function (require, exports, module) {
	"use strict";
	var WSManager = require("websockets/pvs/WSManager"),
        ModelEditor = require("plugins/modelEditor/ModelEditor"),
        Emulink = require("plugins/emulink/Emulink"),
		SafetyTest = require("plugins/safetyTest/SafetyTest"),
        GraphBuilder = require("plugins/graphbuilder/GraphBuilder"),
        PrototypeBuilder = require("plugins/prototypebuilder/PrototypeBuilder"),
		Logger	= require("util/Logger"),
        SaveProjectChanges = require("project/forms/SaveProjectChanges"),
        Notification = require("pvsioweb/forms/displayNotification"),
        NotificationManager = require("project/NotificationManager"),
        Descriptor = require("project/Descriptor"),
        fs = require("util/fileHandler"),
        PluginManager = require("plugins/PluginManager"),
        PVSioWeb = require("PVSioWebClient").getInstance(),
        ProjectManager = require("project/ProjectManager"),
        displayQuestion = require("pvsioweb/forms/displayQuestion");
	
    var template = require("text!pvsioweb/forms/maincontent.handlebars");
    /**
     * @private
     * Shows a prompt to the user signalling that the connection to the server has broken.
     * Also starts a polling timer to check if the server is back up and running. The dialog
     * is automatically dismissed when the server is restarted.
     */
    function reconnectToServer() {
        var timerid,
            q,
            data = {
                header: "Reconnect to server",
                question: "Uh-oh  the server seems to be down :(. Restart it by running ./start.sh" +
                    " from the pvsio-web installation directory. Once you have restarted the server this message will go away",
                buttons: ["Dismiss", "Reconnect"]
            };
        
        function retry() {
            if (!PVSioWeb.isWebSocketConnected()) {
                ProjectManager.getInstance().reconnectToServer()
                    .then(function () {
                        q.remove();
                        clearTimeout(timerid);
                    }).catch(function () {
                        timerid = setTimeout(retry, 1000);
                    });
            } else {
                q.remove();
            }
        }
        //dont create a new question form if one already exists
        if (d3.select(".overlay").empty()) {
            q = displayQuestion.create(data).on("reconnect", function (e, view) {
                if (!PVSioWeb.isWebSocketConnected()) {
                    ProjectManager.getInstance().reconnectToServer()
                        .then(function () {
                            view.remove();
                            clearTimeout(timerid);
                        }).catch(function (err) {
                            view.remove();
                        });
                } else {
                    view.remove();
                }
            }).on("dismiss", function (e, view) {
                view.remove();
            });
            //create a timer to poll the connection to the server
            //this automatically dismisses the dialog after successful reconnection
            timerid = setTimeout(retry, 1000);
        }
    }
    
    /**
     * @private
     * Called when the pvs process has been disconnected. It sets the appropriate UI markers
     * that signifies that the process is disconnected.
     * @param {object|string} err The error message or object returned from the server signifying why the process disconnected
     */
    function pvsProcessDisconnected(err) {
        var pvsioStatus = d3.select("#lblPVSioStatus");
        pvsioStatus.select("span").remove();
        Logger.log(err);
        pvsioStatus.classed("disconnected", true)
            .append("span").attr("class", "glyphicon glyphicon-warning-sign");
        //style("background", "red");
        PVSioWeb.isPVSProcessConnected(false);
    }
    /**
     * @private
     * Called when the pvs process has been connected. It sets the appropriate UI markers
     * that signifies that the process is connected and ready.
     */
    function pvsProcessReady() {
        var pvsioStatus = d3.select("#lblPVSioStatus");
        pvsioStatus.select("span").remove();
        var msg = "PVSio process ready!";
        Logger.log(msg);
        pvsioStatus.append("span").attr("class", "glyphicon glyphicon-ok");
        PVSioWeb.isPVSProcessConnected(true);
    }
    /**
     * @private
     * Called when the websocket connection to the server has been established. It sets the appropriate UI markers
     * that signifies that the websocket connection is active.
     */
    function webSocketConnected() {
        var el = d3.select("#lblWebSocketStatus");
        Logger.log("connection to pvsio server established");
		d3.select("#btnCompile").attr("disabled", null);
        el.classed("disconnected", false)
            .select("span").attr("class", "glyphicon glyphicon-ok");//style("background", "rgb(8, 88, 154)");
        PVSioWeb.isWebSocketConnected(true);
    }
    /**
     * @private
     * Called when the websocket connection to the server has been disconnected. It sets the appropriate UI markers
     * that signifies that the connection is disconnected. It also triggers the disconnection of the pvs process since
     * connection to the pvs process  depends on connection to the server.
     */
    function webSocketDisconnected() {
        var el = d3.select("#lblWebSocketStatus");
        Logger.log("connection to pvsio server closed");
		d3.select("#btnCompile").attr("disabled", true);
        el.classed("disconnected", true)
            .select("span").attr("class", "glyphicon glyphicon-warning-sign");//.style("background", "red");
        PVSioWeb.isWebSocketConnected(false);
        pvsProcessDisconnected("Websocket connection closed");
    }
    

    function updateEditorToolbarButtons(pvsFile, currentProject) {
		//update status of the set main file button based on the selected file
		if (pvsFile) {
			if (currentProject.mainPVSFile() && currentProject.mainPVSFile().path === pvsFile.path) {
				d3.select("#btnSetMainFile").attr("disabled", true);
			} else {
				d3.select("#btnSetMainFile").attr("disabled", null);
			}
        }
	}
    
	function bindListeners(projectManager) {
        var actions, recStartState, recStartTime, scriptName;
        //add event listener for restarting the pvsio web server whenever the project changes
        projectManager.addListener("ProjectChanged", function (event) {
            var pvsioStatus = d3.select("#lblPVSioStatus");
            pvsioStatus.select("span").remove();
            
            var project = event.current;
            var ws = WSManager.getWebSocket();
            ws.lastState("init(0)");
            if (project.mainPVSFile()) {
                // the main file can be in a subfolder: we need to pass information about directories!
                var mainFile = project.mainPVSFile().path.replace(project.name() + "/", "");
                ws.startPVSProcess({name: mainFile, projectName: project.name()}, function (err) {
					//make projectManager bubble the process ready event
                    if (!err) {
                        projectManager.fire({type: "PVSProcessReady"});
                    } else {
                        projectManager.fire({type: "PVSProcessDisconnected"});
                    }
				});
            }
        }).addListener("SelectedFileChanged", function (event) {
            var p = projectManager.project(), file = p.getDescriptor(event.selectedItem.path);
            updateEditorToolbarButtons(file, p);
        }).addListener("PVSProcessReady", function (event) {
            pvsProcessReady();
        }).addListener("PVSProcessDisconnected", function (event) {
            pvsProcessDisconnected();
        });
        
		d3.select("#header #txtProjectName").html("");

		d3.select("#btnSaveProject").on("click", function () {
			projectManager.saveProject();
		});
	
		d3.select("#btnSaveProjectAs").on("click", function () {
            var name = projectManager.project().name() + "_" + (new Date().getFullYear()) + "." +
                            (new Date().getMonth() + 1) + "." + (new Date().getDate());
			projectManager.saveProjectDialog(name);
		});
        
		d3.select("#openProject").on("click", function () {
            function openProject() {
                projectManager.openProjectDialog().then(function (project) {
                    var notification = "Project " + project.name() + " opened successfully!";
                    Logger.log(notification);
                }).catch(function (err) {
                    if (err && err.error) {
                        NotificationManager.error(err.error);
                    } else {
                        Logger.log(JSON.stringify(err));
                    }
                });
            }
            var currentProject = projectManager.project();
            if (currentProject && currentProject._dirty()) {
                //show save project dialog for the current project
                SaveProjectChanges.create(currentProject)
                    .on("yes", function (e, view) {
                        view.remove();
                        projectManager.saveProject().then(function (res) {
                            openProject();
                        }).catch(function (err) { alert(err); });
                    }).on("no", function (e, view) {
                        view.remove();
                        openProject();
                    });
            } else {
                openProject();
            }
		});
	
		d3.select("#newProject").on("click", function () {
			projectManager.createProjectDialog().then(function (res) {
                var notification = "Project " + res.project().name() + "created!";
                Logger.log(notification);
            });
		});
        
        function reloadPVSio() {
            //compilation is emulated by restarting the pvsioweb process on the server
            var project = projectManager.project(), ws = WSManager.getWebSocket();
            if (project && project.mainPVSFile()) {
                ws.lastState("init(0)");
                // the main file can be in a subfolder: we need to pass information about directories!
                var mainFile = project.mainPVSFile().path.replace(project.name() + "/", "");
                ws.startPVSProcess({name: mainFile, projectName: project.name()}, function (err) {
					//make projectManager bubble the process ready event
                    if (!err) {
                        projectManager.fire({type: "PVSProcessReady"});
                    } else {
                        projectManager.fire({type: "PVSProcessDisconnected"});
                    }
				});
            }
        }
        //handle typecheck event
		//this function should be edited to only act on the selected file when multiple files are in use
		d3.select("#btnTypeCheck").on("click", function () {
            function typecheck(pvsFile) {
                var btn = d3.select("#btnTypeCheck").html("Compiling...").attr("disabled", true);
                var ws = WSManager.getWebSocket();
                var fp = pvsFile.path;
                ws.send({type: "typeCheck", path: fp},
                     function (err, res) {
                        btn.html("Compile").attr("disabled", null);
                        var msg = res.stdout;
                        if (!err) {
                            reloadPVSio();
                            var project = projectManager.project();
                            var notification = "File " + fp + " compiled successfully!";
                            msg = msg.substring(msg.indexOf("Proof summary"), msg.length);
                            Notification.create({
                                header: pvsFile.name + " compiled successfully! ",
                                notification: msg.split("\n")
                            }).on("ok", function (e, view) { view.remove(); });
                        } else {
                            var logFile = projectManager.project().name() + "/" + fp.substring(0, fp.length - 4) + ".log";
                            var header = "Compilation error";
                            ws.getFile(logFile, function (err, res) {
                                if (!err) {
                                    msg = res.content.substring(res.content.indexOf("Parsing "));
                                    msg = msg.replace("Parsing", "Error while parsing");
                                } else {
                                    msg = msg.substring(msg.indexOf("Writing output to file"));
                                    header += ", please check the PVS output file for details.";
                                }
                                Notification.create({
                                    header: header,
                                    notification: msg.split("\n")
                                }).on("ok", function (e, view) { view.remove(); });
                            });
                        }
                    });
            }
            
            // if the pvsFile is not specified, we compile the main file
            // note: this happens when a directory is selected
			var pvsFile = projectManager.getSelectedFile() || projectManager.project().mainPVSFile();
            if (!pvsFile) { return; }
			if (pvsFile.dirty()) {
                document.getElementById("btnSaveFile").click();
            }
            typecheck(pvsFile);
		});
        
		d3.select("#btnSetMainFile").on("click", function () {
			var pvsFile = projectManager.getSelectedFile(), project = projectManager.project();
			if (pvsFile) {
				var ws = WSManager.getWebSocket();
				ws.send({type: "setMainFile", projectName: project.name(), name: pvsFile.path}, function (err) {
					//if there was no error update the main file else alert user
                    if (!err) {
                        // set main file
                        project.mainPVSFile(pvsFile);
                        // disable button
                        d3.select("#btnSetMainFile").attr("disabled", true);
                        var notification = pvsFile.path + " is now the Main file";
                        NotificationManager.show(notification);
                        // reload pvsio
                        reloadPVSio();
                    } else {
                        NotificationManager.err(err);
                    }
				});
			}
		});
	
		d3.select("#btnSaveFile").on("click", function () {
			var project = projectManager.project();
			if (project) {
                var descriptor = projectManager.getSelectedFile();
                if (descriptor) {
                    descriptor.content = ModelEditor.getInstance().getEditor().doc.getValue();
                    descriptor.dirty(false);
                    projectManager.project().saveFiles([descriptor], { overWrite: true }).then(function (res) {
                        var notification = descriptor.name + " saved successfully!";
                        NotificationManager.show(notification);
                    }).catch(function (err) {
                        NotificationManager.error(err);
                    });
                }
			}
		});
        d3.select("#btnImportFiles").on("click", function () {
            return new Promise(function (resolve, reject) {
                projectManager.readLocalFileDialog().then(function (files) {
                    var promises = [];
                    function getImportFolderName() {
                        var selectedData = projectManager.getSelectedData();
                        return (selectedData.isDirectory) ? selectedData.path
                                : selectedData.path.split("/").slice(0, -1).join("/");
                    }
                    var importFolder = getImportFolderName();
                    files.forEach(function (file) {
                        file.path = importFolder + "/" + file.path;
                        promises.push(projectManager.writeFileDialog(file.path, file.content, { encoding: file.encoding }));
                    });
                    Promise.all(promises).then(function (res) {
                        resolve(res);
                    }).catch(function (err) { reject(err); });
                }).catch(function (err) { reject(err); });
            });
        });
	}
	
    var  MainView = Backbone.View.extend({
        initialize: function (data) {
			this.render(data);
		},
		render: function (data) {
			var t = Handlebars.compile(template);
			this.$el.html(t(data));
			$("body").append(this.el);
			layoutjs({el: "#content", useFullHeight: true});
			return this;
		},
		events: {
            "change input[type='checkbox']": "checkboxClicked",
            "click .plugin-box": "pluginClicked"
		},
        checkboxClicked: function (event) {
            this.trigger("pluginToggled", event);
        },
        pluginClicked: function (event) {
            if (event.target.tagName.toLowerCase() === "li") {
                d3.select(event.target).select("input[type='checkbox']").node().click();
            }
        },
		scriptClicked: function (event) {
            this.trigger("scriptClicked", $(event.target).attr("name"));
        }
    });
    
    function createHtmlElements(data) {
        return new MainView(data);
    }
    
    
	module.exports = {
		init: function (data) {
            data = data || {plugins: [PrototypeBuilder.getInstance(), ModelEditor.getInstance(),
                                      Emulink.getInstance(), GraphBuilder.getInstance(), SafetyTest.getInstance()].map(function (p) {
                return {label: p.constructor.name, plugin: p};
            })};
            PluginManager.getInstance().init();
            PluginManager.getInstance().addListener("PluginEnabled", function (event) {
                d3.select("#plugin_" + event.plugin.constructor.name).property("checked", true);
            }).addListener("PluginDisabled", function (event) {
                d3.select("#plugin_" + event.plugin.constructor.name).property("checked", false);
            });
            if (this._view) { this.unload(); }
            this._view = createHtmlElements(data);
            return this._view;
        },
        unload: function () {
            this._view.remove();
        },
		bindListeners: function (projectManager) {
			bindListeners(projectManager);
		},
        webSocketConnected: function () {
            webSocketConnected();
        },
        webSocketDisconnected: function () {
            webSocketDisconnected();
        },
        pvsProcessConnected: function () {
            pvsProcessReady();
        },
        pvsProcessDisconnected: function (reason) {
            pvsProcessDisconnected(reason);
        },
        reconnectToServer: function () {
            reconnectToServer();
        }
	};
});