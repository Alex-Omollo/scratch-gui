import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';

import VM from 'scratch-vm';
import AudioEngine from 'scratch-audio';

import {setProjectUnchanged} from '../reducers/project-changed';
import {
    LoadingStates,
    getIsLoadingWithId,
    onLoadedProject,
    projectError
} from '../reducers/project-state';

const vmManagerHOC = function (WrappedComponent) {
    class VMManager extends React.Component {
        constructor (props) {
            super(props);
            bindAll(this, [
                'loadProject',
                'handleLMSMessage',
                'sendProjectToLMS',
                'notifyLMSReady'
            ]);
            this.lmsListener = null;
        }

        componentDidMount () {
            if (!this.props.vm.initialized) {
                this.audioEngine = new AudioEngine();
                this.props.vm.attachAudioEngine(this.audioEngine);
                this.props.vm.setCompatibilityMode(true);
                this.props.vm.initialized = true;
                this.props.vm.setLocale(this.props.locale, this.props.messages);
            }
            if (!this.props.isPlayerOnly && !this.props.isStarted) {
                this.props.vm.start();
            }
            this.lmsListener = this.handleLMSMessage;
            window.addEventListener('message', this.lmsListener);
            this.notifyLMSReady();
        }

        componentDidUpdate (prevProps) {
            if (this.props.isLoadingWithId && this.props.fontsLoaded &&
                (!prevProps.isLoadingWithId || !prevProps.fontsLoaded)) {
                this.loadProject();
            }
            if (!this.props.isPlayerOnly && !this.props.isStarted) {
                this.props.vm.start();
            }
        }

        componentWillUnmount () {
            if (this.lmsListener) {
                window.removeEventListener('message', this.lmsListener);
            }
        }

        notifyLMSReady () {
            if (window.self === window.top) return;
            const origin = process.env.REACT_APP_LMS_ORIGIN || '*';
            window.parent.postMessage({type: 'EDITOR_READY'}, origin);
        }

        handleLMSMessage (event) {
            const origin = process.env.REACT_APP_LMS_ORIGIN || '*';
            if (origin !== '*' && event.origin !== origin) return;

            const {type, project} = event.data || {};
            if (!type) return;

            if (type === 'SET_PROJECT' && project) {
                fetch(project)
                    .then(res => res.arrayBuffer())
                    .then(buffer => this.props.vm.loadProject(buffer))
                    .catch(err => console.error('[LMS] SET_PROJECT failed:', err));
            }

            if (type === 'GET_PROJECT') {
                this.sendProjectToLMS();
            }
        }

        async sendProjectToLMS () {
            if (window.self === window.top) return;
            const origin = process.env.REACT_APP_LMS_ORIGIN || '*';
            try {
                const vm = this.props.vm;
                if (!vm) return;
                const projectData = await vm.saveProjectSb3();
                const blob = new Blob([projectData]);
                const reader = new FileReader();
                reader.onload = () => {
                    window.parent.postMessage(
                        {type: 'PROJECT_DATA', project: reader.result},
                        origin
                    );
                };
                reader.readAsDataURL(blob);
            } catch (err) {
                console.error('[LMS] sendProjectToLMS failed:', err);
            }
        }

        loadProject () {
            return this.props.vm.loadProject(this.props.projectData)
                .then(() => {
                    this.props.onLoadedProject(this.props.loadingState, this.props.canSave);
                    setTimeout(() => this.props.onSetProjectUnchanged());
                    if (!this.props.isStarted) {
                        setTimeout(() => this.props.vm.renderer.draw());
                    }
                })
                .catch(e => this.props.onError(e));
        }

        render () {
            const {
                /* eslint-disable no-unused-vars */
                fontsLoaded,
                loadingState,
                locale,
                messages,
                isStarted,
                onError: onErrorProp,
                onLoadedProject: onLoadedProjectProp,
                onSetProjectUnchanged,
                projectData,
                /* eslint-enable no-unused-vars */
                isLoadingWithId: isLoadingWithIdProp,
                vm,
                ...componentProps
            } = this.props;
            return (
                <WrappedComponent
                    isLoading={isLoadingWithIdProp}
                    vm={vm}
                    {...componentProps}
                />
            );
        }
    }

    VMManager.propTypes = {
        canSave: PropTypes.bool,
        cloudHost: PropTypes.string,
        fontsLoaded: PropTypes.bool,
        isLoadingWithId: PropTypes.bool,
        isPlayerOnly: PropTypes.bool,
        isStarted: PropTypes.bool,
        loadingState: PropTypes.oneOf(LoadingStates),
        locale: PropTypes.string,
        messages: PropTypes.objectOf(PropTypes.string),
        onError: PropTypes.func,
        onLoadedProject: PropTypes.func,
        onSetProjectUnchanged: PropTypes.func,
        projectData: PropTypes.oneOfType([PropTypes.object, PropTypes.string]),
        projectId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
        username: PropTypes.string,
        vm: PropTypes.instanceOf(VM).isRequired
    };

    const mapStateToProps = state => {
        const loadingState = state.scratchGui.projectState.loadingState;
        return {
            fontsLoaded: state.scratchGui.fontsLoaded,
            isLoadingWithId: getIsLoadingWithId(loadingState),
            locale: state.locales.locale,
            messages: state.locales.messages,
            projectData: state.scratchGui.projectState.projectData,
            projectId: state.scratchGui.projectState.projectId,
            loadingState: loadingState,
            isPlayerOnly: state.scratchGui.mode.isPlayerOnly,
            isStarted: state.scratchGui.vmStatus.started
        };
    };

    const mapDispatchToProps = dispatch => ({
        onError: error => dispatch(projectError(error)),
        onLoadedProject: (loadingState, canSave) =>
            dispatch(onLoadedProject(loadingState, canSave, true)),
        onSetProjectUnchanged: () => dispatch(setProjectUnchanged())
    });

    const mergeProps = (stateProps, dispatchProps, ownProps) => Object.assign(
        {}, stateProps, dispatchProps, ownProps
    );

    return connect(
        mapStateToProps,
        mapDispatchToProps,
        mergeProps
    )(VMManager);
};

export default vmManagerHOC;
