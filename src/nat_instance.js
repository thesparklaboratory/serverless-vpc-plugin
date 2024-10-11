const { PUBLIC_SUBNET } = require('./constants');

/**
 * Build a SecurityGroup to be used by the NAT instance
 *
 * @return {Object}
 */
function buildNatSecurityGroup() {
  return {
    NatSecurityGroup: {
      Type: 'AWS::EC2::SecurityGroup',
      Properties: {
        GroupDescription: 'NAT Instance',
        VpcId: {
          Ref: 'VPC',
        },
        SecurityGroupEgress: [
          {
            Description: 'permit outbound HTTP to the Internet',
            IpProtocol: 'tcp',
            FromPort: 80,
            ToPort: 80,
            CidrIp: '0.0.0.0/0',
          },
          {
            Description: 'permit outbound HTTPS to the Internet',
            IpProtocol: 'tcp',
            FromPort: 443,
            ToPort: 443,
            CidrIp: '0.0.0.0/0',
          },
          {
            Description: 'permit outbound DB access to the Internet',
            IpProtocol: 'tcp',
            FromPort: 3306,
            ToPort: 3306,
            CidrIp: '0.0.0.0/0',
          },
        ],
        SecurityGroupIngress: [
          {
            Description: 'permit inbound HTTP from AppSecurityGroup',
            IpProtocol: 'tcp',
            FromPort: 80,
            ToPort: 80,
            SourceSecurityGroupId: {
              Ref: 'AppSecurityGroup',
            },
          },
          {
            Description: 'permit inbound HTTPS from AppSecurityGroup',
            IpProtocol: 'tcp',
            FromPort: 443,
            ToPort: 443,
            SourceSecurityGroupId: {
              Ref: 'AppSecurityGroup',
            },
          },
          {
            Description: 'permit inbound DB access from the Internet',
            IpProtocol: 'tcp',
            FromPort: 3306,
            ToPort: 3306,
            CidrIp: '0.0.0.0/0',
          },
        ],
        Tags: [
          {
            Key: 'Name',
            Value: {
              // eslint-disable-next-line no-template-curly-in-string
              'Fn::Sub': '${AWS::StackName}-nat',
            },
          },
        ],
      },
    },
  };
}

/**
 * Build the NAT instance
 *
 * @param {Object} imageId AMI image ID
 * @param {String} instance type
 * @param {Array} zones Array of availability zones
 * @param {Object} params
 * @return {Object}
 */
function buildNatInstance(imageId, instanceType, zones = [], { name = 'NatInstance' } = {}) {
  if (!imageId) {
    return {};
  }
  if (!Array.isArray(zones) || zones.length < 1) {
    return {};
  }

  return {
    [name]: {
      Type: 'AWS::EC2::Instance',
      DependsOn: 'InternetGatewayAttachment',
      Properties: {
        AvailabilityZone: {
          'Fn::Select': ['0', zones],
        },
        BlockDeviceMappings: [
          {
            DeviceName: '/dev/xvda',
            Ebs: {
              VolumeSize: 10,
              VolumeType: 'gp3',
              DeleteOnTermination: true,
            },
          },
        ],
        IamInstanceProfile: {
          Ref: `${name}InstanceProfile`,
        },
        ImageId: imageId,
        InstanceType: instanceType,
        Monitoring: false,
        NetworkInterfaces: [
          {
            AssociatePublicIpAddress: true,
            DeleteOnTermination: true,
            Description: 'eth0',
            DeviceIndex: '0',
            GroupSet: [
              {
                Ref: 'NatSecurityGroup',
              },
            ],
            SubnetId: {
              Ref: `${PUBLIC_SUBNET}Subnet1`,
            },
          },
        ],
        SourceDestCheck: false, // required for a NAT instance
        Tags: [
          {
            Key: 'Name',
            Value: {
              // eslint-disable-next-line no-template-curly-in-string
              'Fn::Sub': '${AWS::StackName}-nat',
            },
          },
        ],
        UserData: {
          'Fn::Base64': {
            'Fn::Sub': `#!/bin/bash -xe
              yum update -y
              yum install -y https://s3.amazonaws.com/ec2-downloads-windows/SSMAgent/latest/linux_arm64/amazon-ssm-agent.rpm
              systemctl enable fck-nat.service
              systemctl restart fck-nat.service
            `,
          },
        },
      },
    },
    [`${name}Role`]: {
      Type: 'AWS::IAM::Role',
      Properties: {
        AssumeRolePolicyDocument: {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: {
                Service: 'ec2.amazonaws.com',
              },
              Action: 'sts:AssumeRole',
            },
          ],
        },
        ManagedPolicyArns: [
          'arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore', // Ability for SSH
          'arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy', // Ability for Cloudwatch Agent
        ],
        "Policies": [
          // Ability for Cloudwatch Agent
          {
            "PolicyName": "NATSSMPolicy",
            "PolicyDocument": {
              "Version": "2012-10-17",
              "Statement": [
                {
                  "Effect": "Allow",
                  "Action": [
                    "ssm:GetParameter"
                  ],
                  "Resource": "*"
                }
              ]
            }
          },
          // Ability for Static IP
          {
            "PolicyName": "NATEIPolicy",
            "PolicyDocument": {
              "Version": "2012-10-17",
              "Statement": [
                {
                  "Effect": "Allow",
                  "Action": [
                    "ec2:AssociateAddress",
                    "ec2:DisassociateAddress"
                  ],
                  "Resource": "*"
                }
              ]
            }
          },
          // Ability for HA-mode
          {
            "PolicyName": "NATNetworkInterfacePolicy",
            "PolicyDocument": {
              "Version": "2012-10-17",
              "Statement": [
                {
                  "Effect": "Allow",
                  "Action": [
                    "ec2:AttachNetworkInterface",
                    "ec2:DetachNetworkInterface"
                  ],
                  "Resource": "*"
                }
              ]
            }
          }
        ]
      },
    },
    [`${name}InstanceProfile`]: {
      Type: 'AWS::IAM::InstanceProfile',
      Properties: {
        Roles: [
          {
            Ref: `${name}Role`,
          },
        ],
      },
    },
  };
}

module.exports = {
  buildNatInstance,
  buildNatSecurityGroup,
};
